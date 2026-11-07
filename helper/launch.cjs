'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MAX_RESPONSE_BYTES, publicError, fault } = require('./protocol.cjs');
const fail = code => { process.stdout.write(JSON.stringify({ event: 'fatal', error: publicError(fault(code)) }) + '\n'); process.exitCode = 1; };
const index = process.argv.indexOf('--data-dir');
const dataDir = index >= 0 ? process.argv[index + 1] : '';
if (!dataDir || !path.isAbsolute(dataDir)) { fail('setup'); process.exit(); }
let binary;
try {
  const dir = path.dirname(require.resolve('electron/package.json'));
  const relative = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
  binary = path.resolve(dir, 'dist', relative);
  if (!binary.startsWith(path.join(dir, 'dist') + path.sep) || !fs.existsSync(binary)) throw 0;
} catch { fail('setup'); process.exit(); }
const env = { MYGO_QISHUI_HELPER: '1' };
for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'LOCALAPPDATA', 'APPDATA', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', '__CF_USER_TEXT_ENCODING']) {
  if (process.env[key]) env[key] = process.env[key];
}
// Vendor/browser/native stdout and stderr never share the credential-bearing RPC channel.
const child = spawn(binary, [path.join(__dirname, 'main.cjs'), '--data-dir', dataDir], { env, stdio: ['pipe', 'ignore', 'ignore', 'pipe'], windowsHide: true });
let stopped = false, buffer = '';
const stop = () => {
  if (stopped) return; stopped = true;
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGTERM'), 2000); timer.unref();
};
child.on('error', () => { fail('setup'); stopped = true; });
child.stdin.on('error', () => {});
process.stdin.pipe(child.stdin);
process.stdin.on('end', stop);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.stdio[3].setEncoding('utf8');
child.stdio[3].on('data', chunk => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) { fail('protocol'); stop(); return; }
    try { JSON.parse(line); } catch { fail('protocol'); stop(); return; }
    process.stdout.write(line + '\n');
  }
  if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) { fail('protocol'); stop(); }
});
child.on('exit', code => {
  if (!stopped && code !== 0) fail('unavailable');
  process.exitCode = code === 0 ? 0 : 1;
  process.stdin.unpipe(child.stdin); process.stdin.pause();
});
