'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { fault } = require('./protocol.cjs');
// Retrieved from the vendor CDN and cross-checked against the reference runtime.
// SDK contents are downloaded into private app data, never redistributed here.
const ASSETS = Object.freeze([
  { name: 'sdk-glue.js', url: 'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/glue/1.0.0.36/sdk-glue.js', sha256: '42f03c3d8f25c3b4f8c499b456999377b1a9d7c5238a0a95d252d6a64ae91b13', maxBytes: 1024 * 1024 },
  { name: 'bdms.js', url: 'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js', sha256: 'dd918a8d2028d68b47407e205eae01d9d674daa51013bc6c5efc0573e4b0a8e0', maxBytes: 1024 * 1024 },
]);
const digest = b => createHash('sha256').update(b).digest('hex');
async function ensureAsset(dir, asset, fetcher = fetch) {
  if (!/^[a-z-]+\.js$/.test(asset.name) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw fault('integrity');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, asset.name);
  try {
    const stat = await fs.stat(file);
    if (stat.size <= asset.maxBytes && digest(await fs.readFile(file)) === asset.sha256) return file;
  } catch (e) { if (e.code !== 'ENOENT') throw fault('integrity'); }
  const response = await fetcher(asset.url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || response.status !== 200) throw fault('integrity');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > asset.maxBytes) throw fault('integrity');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = Buffer.concat(chunks);
  if (digest(data) !== asset.sha256) throw fault('integrity');
  const tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  try { await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' }); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }); }
  return file;
}
async function ensureAssets(dir) {
  const files = new Map();
  for (const asset of ASSETS) files.set(asset.name, await ensureAsset(dir, asset));
  return files;
}
module.exports = { ASSETS, ensureAsset, ensureAssets };
