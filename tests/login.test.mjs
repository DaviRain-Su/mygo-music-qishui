import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import features from '../helper/features.cjs';
import protocol from '../helper/protocol.cjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const secret = 'sessionid=test-session-secret';
const user = { id: 'user-42', name: 'Test listener' };
const success = { cookie: secret, account: user };
async function loadPlugin(t, handler, options = {}) {
  const service = new features.Features({account:async()=>user,api:(path,params,body)=>handler({op:'request',params:{path,params,body}})});
  const storage = new Map(options.storage || []), calls = [], prompts = [], logs = [], processes = [];
  function process() {
    const lines = [], readers = []; let closed = false, exit;
    const waited = new Promise(resolve => { exit = resolve; });
    const send = packet => { const line = typeof packet === 'string' ? packet : JSON.stringify(packet); readers.length ? readers.shift()(line) : lines.push(line); };
    const proc = {
      pid: 42, write(line) {
        const request = JSON.parse(line); calls.push(request);
        queueMicrotask(async () => {
          if (request.op === 'hello') { send({ id: request.id, ok: true, result: { protocol: options.protocol || 1, version: '0.2.0' } }); return; }
          try {
            const result = request.op === 'catalog' ? await service.dispatch(request.params) : await handler(request, send, proc);
            if (!closed) send({ id: request.id, ok: true, result });
          } catch (error) { if (!closed) send({ id: request.id, ok: false, error: protocol.publicError(error) }); }
        });
      },
      readLine() { return lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve(null) : new Promise(resolve => readers.push(resolve)); },
      wait: () => waited,
      kill() { closed = true; for (const resolve of readers.splice(0)) resolve(null); exit(0); },
      closeStdin() { proc.kill(); }, errorOutput: () => 'untrusted stderr with sessionid=test-session-secret',
    };
    processes.push(proc); return proc;
  }
  const context = vm.createContext({
    URL, URLSearchParams,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 150)), clearTimeout,
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    fetch() { throw new Error('The plugin must not fall back to unsigned HTTP authentication'); },
    host: {
      platform: 'darwin', dir: '/plugin folder/qishui', dataDir: '/private/plugin-data/qishui',
      storage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value), remove: key => storage.delete(key) },
      signInPrompt: value => prompts.push(value),
      spawn(command, args) {
        if (options.noRuntime) throw new Error('program not allowed');
        assert.ok(['node', '/opt/homebrew/bin/node', '/usr/local/bin/node'].includes(command));
        assert.equal(args[0], '/plugin folder/qishui/helper/launch.cjs');
        assert.equal(args.includes(secret), false);
        return process();
      },
    },
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => { throw new Error('The plugin entry stays self-contained'); }); await module.evaluate();
  t.after(() => { service.reset(); for (const proc of processes) proc.kill(); });
  return { plugin: module.namespace, storage, calls, prompts, logs, processes };
}

test('signIn goes through the SDK helper and persists only a verified account result', async t => {
  const { plugin, storage, calls } = await loadPlugin(t, async () => success);
  assert.equal((await plugin.signIn()).id, user.id);
  assert.equal(storage.get('cookie'), secret);
  assert.equal(storage.get('authBackend'), 'sdk-v1');
  assert.equal(calls.filter(c => c.op === 'signIn').length, 1);
  assert.equal((await plugin.account()).id, user.id);
});

test('SDK QR and verification progress reaches the MyGo dialog without host.t', async t => {
  const { plugin, prompts } = await loadPlugin(t, async (request, send) => {
    send({ id: request.id, event: 'prompt', stage: 'waiting-scan', text: '等待扫码', qr: 'https://bff-pc.qishui.com/light/invoke/scan_login?token=test-token' });
    send({ id: request.id, event: 'prompt', stage: 'verification', text: '请在官方窗口验证' });
    return success;
  });
  await plugin.signIn();
  assert.ok(prompts.some(p => p.qr?.includes('bff-pc.qishui.com')));
  assert.ok(prompts.some(p => p.text.includes('官方窗口')));
});

for (const code of [7, 2046]) test(`SDK rejection ${code} is not replaced by a generic successful account`, async t => {
  const { plugin, storage } = await loadPlugin(t, async () => { throw { code: 'api', message: `汽水拒绝请求（错误码 ${code}）`, apiCode: code }; });
  await assert.rejects(plugin.signIn(), error => error.message.includes(String(code)));
  assert.equal(storage.has('cookie'), false);
  assert.equal(storage.get('loginDiagnostic').errorCode, code);
});

for (const result of [null, { cookie: '', account: user }, { cookie: secret, account: { name: 'Generic' } }, { cookie: 'sessionid_extra=bad', account: user }]) {
  test(`invalid helper result is rejected: ${JSON.stringify(result)}`, async t => {
    const { plugin, storage } = await loadPlugin(t, async () => result);
    await assert.rejects(plugin.signIn()); assert.equal(storage.has('cookie'), false);
  });
}

test('an old pure-fetch placeholder account is not treated as SDK-authenticated', async t => {
  const { plugin, processes } = await loadPlugin(t, async () => success, { storage: [['cookie', secret], ['account', { id: 'qishui', name: 'Generic' }]] });
  assert.equal(await plugin.account(), null);
  assert.equal(processes.length, 0);
});

test('missing Node/process permission reports setup, never unsigned HTTP fallback', async t => {
  const { plugin } = await loadPlugin(t, async () => success, { noRuntime: true });
  await assert.rejects(plugin.signIn(), error => error.code === 'setup');
});

test('incompatible helper protocol is rejected before a QR request', async t => {
  const { plugin, calls } = await loadPlugin(t, async () => success, { protocol: 9 });
  await assert.rejects(plugin.signIn(), error => error.code === 'setup');
  assert.equal(calls.some(c => c.op === 'signIn'), false);
});

test('helper EOF rejects the pending login without echoing its stderr', async t => {
  const { plugin } = await loadPlugin(t, async (_request, _send, proc) => { proc.kill(); return new Promise(() => {}); });
  await assert.rejects(plugin.signIn(), error => !error.message.includes('test-session-secret'));
});

test('an invalid JSON response cannot leak credential-bearing output in an error', async t => {
  const { plugin, logs } = await loadPlugin(t, async (_request, send) => { send('garbage sessionid=test-session-secret'); return new Promise(() => {}); });
  await assert.rejects(plugin.signIn(), error => !error.message.includes('test-session-secret'));
  assert.equal(JSON.stringify(logs).includes('test-session-secret'), false);
});

test('helper timeout terminates the process and can be retried', async t => {
  let count = 0;
  const { plugin, processes } = await loadPlugin(t, async () => ++count === 1 ? new Promise(() => {}) : success);
  await assert.rejects(plugin.signIn());
  assert.equal((await plugin.signIn()).id, user.id);
  assert.equal(processes.length, 2);
});

test('only one login may be in flight', async t => {
  const { plugin } = await loadPlugin(t, async () => success);
  const first = plugin.signIn();
  await assert.rejects(plugin.signIn(), error => error.code === 'qishui-busy');
  assert.equal((await first).id, user.id);
});

test('signOut clears both the private SDK session and plugin cache', async t => {
  const { plugin, storage, calls } = await loadPlugin(t, async request => request.op === 'signIn' ? success : null);
  await plugin.signIn(); await plugin.signOut();
  assert.equal(await plugin.account(), null); assert.equal(storage.has('cookie'), false);
  assert.equal(calls.some(c => c.op === 'signOut'), true);
});

test('catalog requests use the same helper, not a separate unsigned cookie request', async t => {
  const { plugin, calls } = await loadPlugin(t, async request => request.op === 'signIn' ? success : { result_groups:[{id:'tracks',data:[],has_more:false}] });
  await plugin.signIn(); await plugin.search({ query: 'test', kind: 'tracks', offset: 0 });
  assert.ok(calls.some(c => c.op === 'catalog' && c.params.method === 'search'));
});

const trackFixture = {
  id: 'feed-item', type: 'track', entity: { track_wrapper: { track: {
    base_info: { id: 'track-7', name: 'Fixture song', duration: 123000 },
    display_info: { cover_url: { urls: ['https://images.test/'], uri: 'cover-key' } },
    related_info: { artist_links: [{ id: 'artist-1', name: 'Fixture artist' }], album_link: { id: 'album-1', name: 'Fixture album' } },
  } } },
};

test('logged-in home sends the PC feed POST and maps track wrappers in milliseconds', async t => {
  const { plugin, calls } = await loadPlugin(t, async request => request.op === 'signIn' ? success : { items: [trackFixture], has_more: true });
  await plugin.signIn(); const home = await plugin.home();
  const request = calls.find(c => c.op === 'catalog');
  assert.equal(request.params.method, 'home');
  assert.equal(home.sections[0].tracks[0].id, 'track-7');
  assert.equal(home.sections[0].tracks[0].duration, 123000);
  assert.equal(home.sections[0].tracks[0].artists[0].name, 'Fixture artist');
  assert.ok(home.sections[0].tracks[0].album.imageUrl.startsWith('https://images.test/cover-key'));
});

test('search handles root result_groups rather than requiring data.data', async t => {
  const { plugin } = await loadPlugin(t, async request => request.op === 'signIn' ? success : { result_groups: [{ id:'tracks', data: [trackFixture], has_more: false }] });
  await plugin.signIn(); const found = await plugin.search({ query: 'test', kind: 'tracks', offset: 0 });
  assert.equal(found.tracks.length, 1); assert.equal(found.tracks[0].id, 'track-7');
});

test('stream requests authorized preparation from the SDK helper and returns its local MP3', async t => {
  const audio = { url: 'file:///private/plugin-data/qishui/auth-sdk/audio-cache/run-test/0123456789abcdef0123456789abcdef.mp3', type: 'mp3', quality: 'standard', bitRate: 128000, size: 123456 };
  const { plugin, calls } = await loadPlugin(t, async request => request.op === 'signIn' ? success : audio);
  await plugin.signIn();
  const result = await plugin.stream({ id: 'track-7', quality: 'standard' });
  assert.equal(result.url, audio.url); assert.equal(result.type, 'mp3');
  assert.ok(calls.some(c => c.op === 'stream' && c.params.id === 'track-7'));
  assert.equal(calls.some(c => c.op === 'request'), false);
});

test('stream cannot use a helper file outside its own private audio-cache', async t => {
  const { plugin } = await loadPlugin(t, async request => request.op === 'signIn' ? success : { url: 'file:///etc/passwd', type: 'mp3', size: 4096 });
  await plugin.signIn(); await assert.rejects(plugin.stream({ id: 'track-7' }));
});

test('playback entitlement denial is shown instead of falling back to another unauthorized URL', async t => {
  const { plugin } = await loadPlugin(t, async request => {
    if (request.op === 'signIn') return success;
    throw { code: 'entitlement', message: '当前账号没有播放权限。' };
  });
  await plugin.signIn(); await assert.rejects(plugin.stream({ id: 'track-7' }), error => error.message.includes('播放权限'));
});

test('diagnostics do not contain private result cookies, QR tokens or account data', async t => {
  const { plugin, storage, logs } = await loadPlugin(t, async () => success);
  await plugin.signIn();
  const output = JSON.stringify([storage.get('loginDiagnostic'), logs]);
  for (const value of ['test-session-secret', user.id, user.name]) assert.equal(output.includes(value), false);
});

for (const type of ['mp3','flac']) test(`stream preserves actual ${type} output and does not report played`, async t => {
  const audio={url:`file:///private/plugin-data/qishui/auth-sdk/audio-cache/run-test/0123456789abcdef0123456789abcdef.${type}`,type,quality:type==='flac'?'lossless':'high',size:4096,...(type==='mp3'?{bitRate:192000}:{})};
  const {plugin,calls}=await loadPlugin(t,async r=>r.op==='signIn'?success:audio);
  await plugin.signIn();const result=await plugin.stream({id:'t1',quality:audio.quality});
  assert.equal(result.type,type);assert.equal(result.quality,audio.quality);assert.equal(result.bitRate,audio.bitRate);
  assert.equal(calls.some(r=>r.op==='catalog'),false);
});
for (const [type,ext] of [['flac','mp3'],['mp3','flac'],['aac','aac']]) test(`stream rejects type/extension ${type}/${ext}`,async t=>{
  const {plugin}=await loadPlugin(t,async r=>r.op==='signIn'?success:{url:`file:///private/plugin-data/qishui/auth-sdk/audio-cache/run-test/0123456789abcdef0123456789abcdef.${ext}`,type,size:4096});
  await plugin.signIn();await assert.rejects(plugin.stream({id:'t1'}));
});
test('bridge timeout during a mutation reports unknown without inventing a confirmed count',async t=>{
 const {plugin}=await loadPlugin(t,async r=>r.op==='signIn'?success:new Promise(()=>{}));
 await plugin.signIn();
 await assert.rejects(plugin.addToPlaylist({id:'p1',trackIds:['t1','t2']}),e=>e.code==='qishui-mutation-unknown'&&e.confirmed===undefined&&!e.message.includes('secret'));
});
