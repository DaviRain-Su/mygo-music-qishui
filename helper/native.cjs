'use strict';
// The official desktop app's native signing module is never redistributed: it is
// discovered on this machine, verified, and cached with its same-directory vendor
// libraries into the private plugin data directory so the plugin keeps working
// after app updates or removal.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SUPPORTED = process.platform === 'darwin' && process.arch === 'arm64';
const MODULE = 'bdms.node';
const RELATIVE = 'Contents/Resources/app.asar.unpacked/' + MODULE;
const APPS = ['汽水音乐.app', 'Soda Music.app'];
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_CACHED_FILES = 32;

function candidatePaths(env = process.env, home = os.homedir()) {
  if (!SUPPORTED) return [];
  const list = [];
  const override = env.MYGO_QISHUI_SDK_APP;
  if (typeof override === 'string') {
    const value = override.trim();
    if (value && path.isAbsolute(value)) list.push(path.resolve(value));
  }
  for (const dir of ['/Applications', path.join(home, 'Applications')]) {
    for (const app of APPS) list.push(path.join(dir, app, RELATIVE));
  }
  return list;
}

function isFile(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }

function findSource(env = process.env, home = os.homedir()) {
  for (const candidate of candidatePaths(env, home)) {
    if (isFile(candidate)) return candidate;
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory() && isFile(path.join(candidate, RELATIVE))) return path.join(candidate, RELATIVE);
  }
  return null;
}

function digest(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function nativeDir(dataDir) { return path.join(dataDir, 'native'); }
function modulePath(dataDir) { return path.join(nativeDir(dataDir), MODULE); }
function manifestPath(dataDir) { return path.join(nativeDir(dataDir), 'bdms.json'); }
function safeName(name) { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..'); }

// A missing or altered @rpath companion library breaks module loading, so the
// cache holds the whole vendor directory and every file carries its own digest.
function store(dataDir, source) {
  try {
    if (!isFile(source)) return null;
    const names = fs.readdirSync(path.dirname(source));
    if (names.length > MAX_CACHED_FILES) return null;
    const files = [];
    for (const name of names) {
      if (!safeName(name) || name.endsWith('.tmp')) continue;
      const file = path.join(path.dirname(source), name);
      if (!isFile(file)) continue;
      const data = fs.readFileSync(file);
      if (data.length < 1 || data.length > MAX_FILE_BYTES) return null;
      files.push({ name, size: data.length, sha256: digest(data) });
    }
    if (!files.some(file => file.name === MODULE)) return null;
    fs.mkdirSync(nativeDir(dataDir), { recursive: true, mode: 0o700 });
    fs.chmodSync(nativeDir(dataDir), 0o700);
    for (const file of files) {
      const raw = fs.readFileSync(path.join(path.dirname(source), file.name));
      stagedWrite(path.join(nativeDir(dataDir), file.name), raw);
    }
    stagedWrite(manifestPath(dataDir), Buffer.from(JSON.stringify({ name: MODULE, files })));
    return files;
  } catch { return null; }
}

function stagedWrite(target, data) {
  const staged = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(staged, data, { mode: 0o600, flag: 'wx' });
    fs.renameSync(staged, target);
  } finally { fs.rmSync(staged, { force: true }); }
}

function loadVerified(dataDir) {
  try {
    const raw = fs.readFileSync(manifestPath(dataDir));
    if (raw.length === 0 || raw.length > MAX_MANIFEST_BYTES) return null;
    const manifest = JSON.parse(raw);
    if (manifest?.name !== MODULE || !Array.isArray(manifest.files) || manifest.files.length === 0 ||
        manifest.files.length > MAX_CACHED_FILES || !manifest.files.some(file => file.name === MODULE)) return null;
    for (const file of manifest.files) {
      if (!safeName(file.name) || !/^[0-9a-f]{64}$/.test(file.sha256) ||
          !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return null;
      const data = fs.readFileSync(path.join(nativeDir(dataDir), file.name));
      if (data.length !== file.size || digest(data) !== file.sha256) return null;
    }
    return modulePath(dataDir);
  } catch { return null; }
}

function attach(moduleRef, deviceId) {
  if (typeof moduleRef?.init !== 'function' || typeof moduleRef?.generateHttpSignatureHeaders !== 'function') return null;
  moduleRef.init({ deviceId });
  return moduleRef;
}

// Source copy wins while the official app is installed (keeps the cache fresh);
// the verified cache is the fallback once the app has been updated or removed.
function resolveNative({ dataDir, deviceId, loader = require, env = process.env, home = os.homedir() } = {}) {
  if (!SUPPORTED) return null;
  const use = file => { try { return attach(loader(file), deviceId); } catch { return null; } };
  const source = findSource(env, home);
  if (source) { const sdk = use(source); if (sdk) { store(dataDir, source); return sdk; } }
  const cached = loadVerified(dataDir);
  if (cached) return use(cached);
  return null;
}

module.exports = { SUPPORTED, candidatePaths, findSource, loadVerified, store, resolveNative };
