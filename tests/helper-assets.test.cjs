const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ensureAsset } = require('../helper/assets.cjs');
const bytes = Buffer.from('verified SDK fixture');
const asset = { name: 'fixture.js', url: 'https://vendor.test/fixture.js', sha256: createHash('sha256').update(bytes).digest('hex'), maxBytes: 100 };

test('asset cache is content verified and does not fetch a valid cached file', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qishui-asset-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(bytes); };
  const file = await ensureAsset(dir, asset, fetcher);
  assert.deepEqual(await fs.readFile(file), bytes);
  await ensureAsset(dir, asset, fetcher);
  assert.equal(calls, 1);
});

test('a digest mismatch, redirect or oversized download is never installed', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qishui-asset-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const response of [new Response('tampered'), new Response(null, { status: 302, headers: { location: 'https://evil.test' } }), new Response('x'.repeat(101))]) {
    await assert.rejects(ensureAsset(dir, asset, async () => response));
    await assert.rejects(fs.access(path.join(dir, 'fixture.js')));
  }
});
