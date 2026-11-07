const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { Playback, downloadAudio, transcode } = require('../helper/playback.cjs');

function fixture() {
  return { track: { duration: 180000, label_info: { quality_map: { medium: { play_detail: { need_vip: false, need_purchase: false } } } } },
    track_player: { video_model: JSON.stringify({ video_duration: 180, video_list: [{ main_url: 'https://v3-luna.douyinvod.com/audio?private-signature=test-secret', video_meta: { quality: 'medium', vtype: 'm4a', codec_type: 'aac' }, encrypt_info: { encrypt: false } }] }) } };
}
async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qishui-playback-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
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
