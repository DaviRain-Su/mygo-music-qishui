'use strict';
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const { defaultDataDir } = require('./dependencies.cjs');
const login = process.argv.includes('--login');
const at = process.argv.indexOf('--data-dir');
const dataDir = at >= 0 ? path.resolve(process.argv[at + 1]) : defaultDataDir();
const child = spawn(process.execPath, [path.join(__dirname, 'launch.cjs'), '--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map(); let nextId = 0;
const request = (op, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, op, params }) + '\n');
});
readline.createInterface({ input: child.stdout }).on('line', line => {
  let packet;
  try { packet = JSON.parse(line); } catch { return; }
  if (packet.event === 'prompt') { console.log(JSON.stringify({ stage: packet.stage })); return; }
  if (packet.event === 'fatal') { for (const value of pending.values()) value.reject(packet.error); pending.clear(); return; }
  const value = pending.get(packet.id); if (!value) return;
  pending.delete(packet.id); packet.ok ? value.resolve(packet.result) : value.reject(packet.error);
});
child.on('exit', () => { for (const value of pending.values()) value.reject({ code: 'stopped', message: '辅助程序已退出。' }); pending.clear(); });
const timeout = setTimeout(() => { child.stdin.end(); child.kill(); process.exitCode = 1; }, login ? 285000 : 75000);
(async () => {
  const hello = await request('hello'); console.log(JSON.stringify({ protocol: hello.protocol, version: hello.version }));
  if (login) {
    const result = await request('signIn', { showWindow: true });
    // Never print result.cookie, account id/name or any raw helper response.
    console.log(JSON.stringify({ authenticated: Boolean(result?.cookie && result?.account?.id), accountVerified: Boolean(result?.account?.id) }));
  } else console.log(JSON.stringify(await request('probe')));
})().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code || 'unknown', ...(Number.isInteger(error.apiCode) ? { apiCode: error.apiCode } : {}) }));
  process.exitCode = 1;
}).finally(async () => {
  try { await Promise.race([request('shutdown'), new Promise(resolve => setTimeout(resolve, 2000))]); } catch {}
  child.stdin.end(); clearTimeout(timeout);
});
