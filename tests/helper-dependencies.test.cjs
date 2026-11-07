const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runtimeLayout, dependencyKey, defaultDataDir, loadRuntime, resolveElectron } = require('../helper/dependencies.cjs');
const { installRuntime } = require('../helper/install.cjs');

const manifest = { name: 'plugin', version: '0.2.1', dependencies: { electron: '44.9.3', qrcode: '1.5.4', react: '18.3.1', 'react-dom': '18.3.1' } };
const lock = { lockfileVersion: 3, name: 'plugin', version: '0.2.1', packages: { '': manifest, 'node_modules/electron': { version: '44.9.3', integrity: 'sha512-test' } } };

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qishui-dependencies-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'plugin', 'helper');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(source, 'package-lock.json'), JSON.stringify(lock));
  const dataDir = path.join(root, 'plugin-data', 'qishui', 'auth-sdk');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'keep-session'), 'never remove account data');
  return { root, source, dataDir };
}
async function fakePackages(layout) {
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const dir = path.join(layout.root, 'node_modules', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
    await fs.writeFile(path.join(dir, 'index.js'), 'module.exports = {};');
  }
  const dir = path.join(layout.root, 'node_modules/electron');
  const relative = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron';
  await fs.mkdir(path.dirname(path.join(dir, 'dist', relative)), { recursive: true });
  await fs.writeFile(path.join(dir, 'dist', relative), 'fixture', { mode: 0o755 });
  await fs.writeFile(path.join(dir, 'dist/version'), '44.9.3');
  await fs.writeFile(path.join(dir, 'path.txt'), relative);
}

test('runtime lives outside plugin code and auth profile, keyed by dependency content', async t => {
  const { source, dataDir } = await sandbox(t);
  const layout = runtimeLayout(dataDir, source);
  assert.equal(path.dirname(layout.root), path.join(path.dirname(dataDir), 'sdk-runtime'));
  assert.equal(layout.root.startsWith(source), false);
  assert.equal(layout.root.startsWith(dataDir + path.sep), false);
  assert.throws(() => runtimeLayout('relative/path', source));
  const copy = structuredClone(lock); copy.version = '9.0.0'; copy.packages[''].version = '9.0.0';
  assert.equal(dependencyKey(manifest, lock), dependencyKey({ ...manifest, version: '9.0.0' }, copy));
  copy.packages['node_modules/electron'].version = '45.0.0';
  assert.notEqual(dependencyKey(manifest, lock), dependencyKey(manifest, copy));
});

test('installer performs commands only in the external runtime, not in plugin source', async t => {
  const { source, dataDir } = await sandbox(t); const calls = [];
  const run = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    assert.equal(cwd.startsWith(source), false);
    await fakePackages(runtimeLayout(dataDir, source));
  };
  await installRuntime({ dataDir, sourceDir: source, run, report() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.includes('ci'), true);
  assert.equal(calls[0].args.includes('--ignore-scripts'), true);
  assert.equal((await fs.readFile(path.join(dataDir, 'keep-session'), 'utf8')), 'never remove account data');
  await assert.rejects(fs.access(path.join(source, 'node_modules')));
  const runtime = loadRuntime(dataDir, source);
  assert.ok(resolveElectron(runtime).includes('sdk-runtime'));
  await installRuntime({ dataDir, sourceDir: source, run, report() {} });
  assert.equal(calls.length, 2, 'same dependencies must not reinstall after a code update');
});

test('failed install leaves no ready marker and does not touch the auth profile', async t => {
  const { source, dataDir } = await sandbox(t);
  await assert.rejects(installRuntime({ dataDir, sourceDir: source, run: async () => { throw new Error('npm failed'); }, report() {} }));
  assert.throws(() => loadRuntime(dataDir, source));
  assert.equal(await fs.readFile(path.join(dataDir, 'keep-session'), 'utf8'), 'never remove account data');
});

test('local helper/node_modules never acts as a fallback for a missing external runtime', async t => {
  const { source, dataDir } = await sandbox(t);
  await fs.mkdir(path.join(source, 'node_modules'), { recursive: true });
  assert.throws(() => loadRuntime(dataDir, source), error => error.code === 'setup');
});

test('Electron path.txt cannot execute a path outside its pinned dist directory', async t => {
  const { source, dataDir } = await sandbox(t);
  await installRuntime({ dataDir, sourceDir: source, run: async () => fakePackages(runtimeLayout(dataDir, source)), report() {} });
  const runtime = loadRuntime(dataDir, source);
  await fs.writeFile(path.join(runtime.root, 'node_modules/electron/path.txt'), '../../../../unexpected-program');
  assert.throws(() => resolveElectron(runtime), error => error.code === 'setup');
});

test('default path follows an installed plugin application root, including dev editions', () => {
  const helper = '/Users/example/Library/Application Support/MyGo Music Dev/plugins/qishui/helper';
  assert.equal(defaultDataDir(helper), '/Users/example/Library/Application Support/MyGo Music Dev/plugin-data/qishui/auth-sdk');
});
