const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const native = require('../helper/native.cjs');
const { publicError, MESSAGES } = require('../helper/protocol.cjs');
const fixtureModule = 'module.exports = { init() {}, generateHttpSignatureHeaders() { return "x-a\\r\\n1"; } };';

function digest(data) { return createHash('sha256').update(data).digest('hex'); }

async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qishui-native-' + label + '-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('search order is the explicit override first, then /Applications and ~/Applications app names', (t) => {
  if (!native.SUPPORTED) return t.skip('native signing module only loads on darwin arm64');
  const home = '/home/tester';
  const relative = 'Contents/Resources/app.asar.unpacked/bdms.node';
  const paths = native.candidatePaths({ MYGO_QISHUI_SDK_APP: '/custom/Soda.app' }, home);
  assert.equal(paths[0], '/custom/Soda.app');
  for (const dir of ['/Applications', path.join(home, 'Applications')]) for (const app of ['汽水音乐.app', 'Soda Music.app']) {
    assert.ok(paths.includes(path.join(dir, app, relative)));
  }
  assert.equal(native.candidatePaths({}, home).some(p => p.includes('MYGO_QISHUI_SDK_APP')), false);
});

test('findSource accepts an app bundle directory, a direct module file, and stops at the first existing one', async t => {
  if (!native.SUPPORTED) return t.skip('native signing module only loads on darwin arm64');
  const bundle = await tempDir(t, 'source');
  const env = { MYGO_QISHUI_SDK_APP: path.join(bundle, '汽水音乐.app') };
  const inner = path.join(bundle, '汽水音乐.app', 'Contents/Resources/app.asar.unpacked');
  await fs.mkdir(inner, { recursive: true });
  const nested = path.join(inner, 'bdms.node');
  await fs.writeFile(nested, fixtureModule);
  assert.equal(native.findSource(env, bundle), nested);
  await fs.rm(path.join(bundle, '汽水音乐.app'), { recursive: true, force: true });
  const direct = path.join(bundle, 'bdms.node');
  await fs.writeFile(direct, fixtureModule);
  assert.equal(native.findSource({ MYGO_QISHUI_SDK_APP: direct }, bundle), direct);
  assert.equal(native.findSource({}, bundle), null);
});

test('the cache stores the module with its @rpath companion libraries and verifies each file', async t => {
  const dir = await tempDir(t, 'cache');
  assert.equal(native.loadVerified(dir), null);
  const source = await tempDir(t, 'vendor');
  await fs.writeFile(path.join(source, 'bdms.node'), fixtureModule);
  await fs.writeFile(path.join(source, 'libMetaSecML.dylib'), 'vendor-library-bytes');
  // a subdirectory must not be followed or cached
  await fs.mkdir(path.join(source, 'subdir'));
  await fs.writeFile(path.join(source, 'subdir', 'ignored'), 'x');
  const manifest = native.store(dir, path.join(source, 'bdms.node'));
  assert.deepEqual(manifest.map(f => f.name), ['bdms.node', 'libMetaSecML.dylib']);
  assert.deepEqual(await fs.readFile(path.join(dir, 'native', 'bdms.node')), Buffer.from(fixtureModule));
  assert.equal(native.loadVerified(dir), path.join(dir, 'native', 'bdms.node'));
  await fs.appendFile(path.join(dir, 'native', 'libMetaSecML.dylib'), 'tampered');
  assert.equal(native.loadVerified(dir), null);
  await fs.writeFile(path.join(dir, 'native', 'libMetaSecML.dylib'), 'vendor-library-bytes');
  assert.equal(native.loadVerified(dir), path.join(dir, 'native', 'bdms.node'));
  await fs.unlink(path.join(dir, 'native', 'libMetaSecML.dylib'));
  assert.equal(native.loadVerified(dir), null);
  assert.equal(native.store(dir, path.join(dir, 'missing.source')), null);
});

test('resolveNative attaches the module from the app, then keeps the hash-checked cache usable without the app', async t => {
  if (!native.SUPPORTED) return t.skip('native signing module only loads on darwin arm64');
  const dir = await tempDir(t, 'attach');
  const source = path.join(dir, 'bdms.node');
  await fs.writeFile(source, fixtureModule);
  const modules = { [source]: { init(hints) { modules.seeded = hints.deviceId; }, generateHttpSignatureHeaders: () => 'x-a\r\n1' } };
  const loader = file => modules[file];
  const env = { MYGO_QISHUI_SDK_APP: path.join(dir, 'unrelated.app') };
  const found = native.resolveNative({ dataDir: dir, deviceId: '1234', loader, env });
  assert.equal(found, null); // the override points nowhere, the cache is still empty
  assert.equal(native.resolveNative({ dataDir: dir, deviceId: '1234', loader, env: { MYGO_QISHUI_SDK_APP: source } }), modules[source]);
  assert.equal(modules.seeded, '1234');
  assert.equal(fsSync.existsSync(path.join(dir, 'native', 'bdms.node')), true);
  // App removed: the verified cache keeps the plugin working on this machine.
  const cached = native.loadVerified(dir);
  const reloaded = { init(hints) { this.seeded = hints.deviceId; }, generateHttpSignatureHeaders: () => 'x-a\r\n1' };
  assert.equal(native.resolveNative({ dataDir: dir, deviceId: '1234', loader: file => file === cached ? reloaded : (() => { throw new Error('app unavailable'); })() }), reloaded);
  assert.equal(reloaded.seeded, '1234');
});

test('a module without both required native hooks is refused, and the cache is never trusted blind', async t => {
  if (!native.SUPPORTED) return t.skip('native signing module only loads on darwin arm64');
  const dir = await tempDir(t, 'refuse');
  const source = path.join(dir, 'bdms.node');
  await fs.writeFile(source, fixtureModule);
  assert.equal(native.resolveNative({ dataDir: dir, deviceId: '1', loader: () => ({ init() {} }) }), null);
  assert.equal(native.resolveNative({ dataDir: dir, deviceId: '1', loader: () => { throw new Error('cannot execute'); } }), null);
  // A cached file whose bytes drift from its recorded digest is rejected even if the loader would accept it.
  await fs.mkdir(path.join(dir, 'native'), { recursive: true });
  await fs.writeFile(path.join(dir, 'native', 'bdms.node'), fixtureModule);
  await fs.writeFile(path.join(dir, 'native', 'bdms.json'), JSON.stringify({
    name: 'bdms.node',
    files: [{ name: 'bdms.node', size: fixtureModule.length, sha256: digest(Buffer.from('other-bytes')) }],
  }));
  assert.equal(native.resolveNative({ dataDir: dir, deviceId: '1', loader: () => ({ init() {}, generateHttpSignatureHeaders() {} }) }), null);
});

test('a missing module reports one specific native message, not the node install hint', () => {
  assert.throws(() => { throw Object.assign(new Error(), { code: 'native' }); });
  assert.match(MESSAGES.native, /签名模块/);
  assert.doesNotMatch(MESSAGES.native, /install\.cjs/);
  const error = new Error(); error.code = 'native';
  assert.equal(publicError(error).message, MESSAGES.native);
});
