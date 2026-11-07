const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { Playback, downloadAudio, transcode } = require('../helper/playback.cjs');

function fixture() {
  return { track: { duration: 180000, label_info: { quality_map: { medium: { play_detail: { need_vip: false, need_purchase: false } } } } },
    track_player: { video_model: JSON.stringify({ video_duration: 180, video_list: [{ main_url: 'https://v3-luna.douyinvod.com/audio?private-signature=test-secret', video_meta: { quality: 'medium', vtype: 'm4a', codec_type: 'aac' }, encrypt_info: { encrypt: false } }] }) } };
}
async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.quality-playback-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}

test('prepares an authorized local MP3 and keeps URL/key/cookie out of the result', async t => {
  const root = await sandbox(t); let prepares = 0;
  const playback = new Playback({ dataDir: root,
    api: async (pathname) => pathname.endsWith('/me') ? { my_info: { is_vip: false } } : fixture(),
    fetcher: async (_url, options) => { assert.equal(options.headers?.Cookie, undefined); return new Response(Buffer.from('plain-audio-fixture')); },
    encoder: async (input, output) => { prepares++; assert.equal(await fs.readFile(input, 'utf8'), 'plain-audio-fixture'); await fs.writeFile(output, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2048)])); },
  });
  t.after(() => playback.close());
  const result = await playback.prepare({ id: 'track-1', quality: 'standard' });
  assert.equal(result.type, 'mp3'); assert.ok(result.url.startsWith('file:'));
  assert.equal(result.url.includes('test-secret'), false); assert.ok(result.size > 1024);
  const again = await playback.prepare({ id: 'track-1', quality: 'standard' });
  assert.equal(again.url, result.url); assert.equal(prepares, 1);
  assert.equal((await fs.stat(fileURLToPath(result.url))).mode & 0o777, 0o600);
  await playback.close(); await assert.rejects(fs.access(fileURLToPath(result.url)));
});

test('failed encoding removes temporary clear audio and does not return a fake stream', async t => {
  const root = await sandbox(t);
  const playback = new Playback({ dataDir: root, api: async p => p.endsWith('/me') ? { my_info: {} } : fixture(),
    fetcher: async () => new Response('input'), encoder: async () => { throw new Error('ffmpeg failed with secret'); } });
  await assert.rejects(playback.prepare({ id: 'track-1' }), e => !e.message.includes('secret'));
  await playback.close();
  assert.equal((await fs.readdir(path.join(root, 'audio-cache'))).length, 0);
});

test('denied rights prevent even downloading the available URL', async t => {
  const root = await sandbox(t); const p = fixture(); p.track.label_info.quality_map.medium.play_detail.need_purchase = true;
  const playback = new Playback({ dataDir: root, api: async name => name.endsWith('/me') ? { my_info: { is_vip: true } } : p,
    fetcher: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(playback.prepare({ id: 'track-1' }), error => error.code === 'entitlement'); await playback.close();
});

test('audio download has size and redirect host limits', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(downloadAudio('https://v3-luna.douyinvod.com/file', signal, async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })));
  await assert.rejects(downloadAudio('https://v3-luna.douyinvod.com/file', signal, async () => new Response('large', { headers: { 'content-length': '9999999999' } })));
});

test('invalid identifiers cannot become file paths or remote requests', async t => {
  const root = await sandbox(t); const playback = new Playback({ dataDir: root, api: async () => { throw new Error('not reached'); } });
  for (const id of ['../key', 'https://evil.test', '', 'a'.repeat(300)]) await assert.rejects(playback.prepare({ id }));
  await playback.close();
});

test('synthetic FLAC stays lossless through MP4 extraction, ffmpeg and separate caches', { timeout: 15000 }, async t => {
  const { spawnSync } = require('node:child_process');
  const { losslessAudio } = require('../helper/audio.cjs');
  const root = await sandbox(t), source = path.join(root, 'source.flac'), mp4 = path.join(root, 'source.mp4');
  function ffmpeg(args) {
    const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args], { timeout: 4000, maxBuffer: 65536 });
    assert.equal(result.status, 0, 'local ffmpeg fixture generation must succeed');
  }
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'flac', source]);
  ffmpeg(['-i', source, '-c:a', 'copy', '-strict', '-2', mp4]);
  const raw = await fs.readFile(source), container = await fs.readFile(mp4);
  assert.deepEqual(losslessAudio(raw), raw);
  const extracted = losslessAudio(container); assert.equal(extracted.subarray(0, 4).toString(), 'fLaC');
  const extractedFile = path.join(root, 'extracted.flac'); await fs.writeFile(extractedFile, extracted);
  ffmpeg(['-i', source, '-f', 's16le', path.join(root, 'a.pcm')]);
  ffmpeg(['-i', extractedFile, '-f', 's16le', path.join(root, 'b.pcm')]);
  assert.deepEqual(await fs.readFile(path.join(root, 'a.pcm')), await fs.readFile(path.join(root, 'b.pcm')));
  const p = fixture(), model = JSON.parse(p.track_player.video_model);
  model.video_list[0].video_meta.codec_type = 'flac'; p.track_player.video_model = model;
  const playback = new Playback({ dataDir: root, api: async name => name.endsWith('/me') ? { my_info: {} } : p,
    fetcher: async () => new Response(container) });
  t.after(() => playback.close());
  const result = await playback.prepare({ id: 'synthetic', quality: 'lossless' });
  assert.equal(result.type, 'flac'); assert.equal(result.quality, 'lossless'); assert.ok(result.url.endsWith('.flac'));
  assert.equal(result.bitRate, undefined);
  assert.equal((await fs.readFile(fileURLToPath(result.url))).subarray(0, 4).toString(), 'fLaC');
  assert.equal(playback.cache.has('synthetic:lossless:flac'), true);
  assert.equal((await playback.prepare({ id: 'synthetic', quality: 'lossless' })).url, result.url);
  await assert.rejects(playback.prepare({ id: 'synthetic', quality: 'high' }));
  assert.equal((await fs.readdir(await playback.init())).filter(n => n.startsWith('work-')).length, 0);
});

test('aborted encoder and invalid lossless output clean partial files', { timeout: 3000 }, async t => {
  const root = await sandbox(t);
  const p = fixture(); p.track_player.video_model = JSON.parse(p.track_player.video_model);
  p.track_player.video_model.video_list[0].video_meta.codec_type = 'flac';
  const raw = Buffer.concat([Buffer.from('fLaC'), Buffer.from([128, 0, 0, 34]), Buffer.alloc(34), Buffer.alloc(2048)]);
  for (const abort of [false, true]) {
    let playback;
    playback = new Playback({ dataDir: root, api: async name => name.endsWith('/me') ? {} : p,
      fetcher: async () => new Response(raw), encoder: async (_input, output) => {
        await fs.writeFile(output, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2048)]));
        if (abort) for (const controller of playback.controllers) controller.abort();
      } });
    await assert.rejects(playback.prepare({ id: 'test', quality: 'lossless' }), { code: abort ? 'timeout' : 'ffmpeg' });
    assert.deepEqual(await fs.readdir(await playback.init()), []);
    await playback.close();
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcode('unused', 'unused', 128, controller.signal), { code: 'timeout' });
});
