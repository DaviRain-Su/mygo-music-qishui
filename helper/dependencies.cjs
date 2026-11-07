'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { fault } = require('./protocol.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function dependencyKey(manifest, lock) {
  // Code releases don't invalidate the runtime; changes to the locked dependency tree do.
  const packages = { ...lock.packages, '': { dependencies: manifest.dependencies } };
  return createHash('sha256').update(JSON.stringify(canonical({ dependencies: manifest.dependencies, lockfileVersion: lock.lockfileVersion, packages }))).digest('hex').slice(0, 24);
}
function defaultDataDir(sourceDir = __dirname) {
  const plugin = path.dirname(sourceDir), plugins = path.dirname(plugin);
  if (path.basename(plugin) === 'qishui' && path.basename(plugins) === 'plugins') {
    return path.join(path.dirname(plugins), 'plugin-data', 'qishui', 'auth-sdk');
  }
  const config = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(config, 'MyGo Music', 'plugin-data', 'qishui', 'auth-sdk');
}
function runtimeLayout(dataDir, sourceDir = __dirname) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw fault('setup');
  let manifest, lock;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
    lock = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package-lock.json'), 'utf8'));
    if (!manifest.dependencies?.electron || lock.lockfileVersion !== 3 || !lock.packages) throw 0;
  } catch { throw fault('setup'); }
  const key = dependencyKey(manifest, lock) + '-' + process.platform + '-' + process.arch;
  const root = path.join(path.dirname(path.resolve(dataDir)), 'sdk-runtime', key);
  if (root === path.resolve(sourceDir) || root.startsWith(path.resolve(sourceDir) + path.sep)) throw fault('setup');
  return { root, key, manifest, lock, dataDir: path.resolve(dataDir) };
}
function resolveElectron(runtime) {
  try {
    const dir = path.join(runtime.root, 'node_modules', 'electron');
    if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version !== runtime.manifest.dependencies.electron) throw 0;
    const relative = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
    const expected = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron';
    if (relative !== expected) throw 0;
    const dist = path.join(dir, 'dist'), binary = path.join(dist, relative);
    if (fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '') !== runtime.manifest.dependencies.electron) throw 0;
    const realBinary = fs.realpathSync(binary), realDist = fs.realpathSync(dist);
    if (!realBinary.startsWith(realDist + path.sep) || !fs.statSync(realBinary).isFile()) throw 0;
    return binary;
  } catch { throw fault('setup'); }
}
function validatePackages(runtime) {
  try {
    for (const [name, version] of Object.entries(runtime.manifest.dependencies)) {
      const file = path.join(runtime.root, 'node_modules', name, 'package.json');
      if (JSON.parse(fs.readFileSync(file, 'utf8')).version !== version) throw 0;
    }
    resolveElectron(runtime);
  } catch { throw fault('setup'); }
}
function loadRuntime(dataDir, sourceDir = __dirname) {
  const runtime = runtimeLayout(dataDir, sourceDir);
  try {
    const ready = JSON.parse(fs.readFileSync(path.join(runtime.root, 'ready.json'), 'utf8'));
    if (ready.key !== runtime.key) throw 0;
    validatePackages(runtime);
  } catch { throw fault('setup'); }
  // Resolve exclusively from plugin-data; never from helper/node_modules or global NODE_PATH.
  runtime.require = createRequire(path.join(runtime.root, 'package.json'));
  return runtime;
}
module.exports = { dependencyKey, defaultDataDir, runtimeLayout, validatePackages, loadRuntime, resolveElectron };
