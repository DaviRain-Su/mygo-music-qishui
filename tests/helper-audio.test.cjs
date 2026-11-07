const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { playbackKey, decryptAudio, selectAudio } = require('../helper/audio.cjs');
const keyHex = '00112233445566778899aabbccddeeff';
const key = Buffer.from(keyHex, 'hex');
function wrapKey(hex) {
  const plain = Buffer.from('0' + hex); const coded = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) {
    let count = 0; for (let x = i; x; x >>>= 1) count += x & 1;
    coded[i] = (plain[i] + count + 21) ^ (i < 2 ? [250, 85][i] : coded[i - 2]);
  }
  return Buffer.concat([Buffer.from([48 ^ coded[0] ^ coded[1]]), coded]).toString('base64');
}
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...parts) => { const data = Buffer.concat(parts); return Buffer.concat([u32(data.length + 8), Buffer.from(type), data]); };
const full = (type, ...parts) => box(type, Buffer.alloc(4), ...parts);
function encryptedFixture() {
  const samples = [Buffer.from('first-audio-sample'), Buffer.from('second-audio-sample')];
  const ivs = [Buffer.alloc(8, 1), Buffer.alloc(8, 2)];
  const enc = samples.map((sample, i) => { const cipher = crypto.createCipheriv('aes-128-ctr', key, Buffer.concat([ivs[i], Buffer.alloc(8)])); return Buffer.concat([cipher.update(sample), cipher.final()]); });
  const sinf = box('sinf', box('frma', Buffer.from('mp4a')), full('schm', Buffer.from('cenc'), u32(65536)));
  const stsd = full('stsd', u32(1), box('enca', Buffer.alloc(28), sinf));
  const stsz = full('stsz', u32(0), u32(2), ...samples.map(s => u32(s.length)));
  const stsc = full('stsc', u32(1), u32(1), u32(1), u32(1));
  const senc = full('senc', u32(2), ...ivs);
  const makeMoov = offsets => box('moov', box('trak', box('mdia', full('hdlr', u32(0), Buffer.from('soun'), Buffer.alloc(12)), box('minf', box('stbl', stsd, stsz, stsc, full('stco', u32(2), ...offsets.map(u32)), senc)))));
  const moov = makeMoov([0, 0]);
  const offsets = [moov.length + 8 + 3, moov.length + 8 + 3 + samples[0].length + 5];
  const bytes = Buffer.concat([makeMoov(offsets), box('mdat', Buffer.alloc(3), enc[0], Buffer.alloc(5), enc[1])]);
  return { bytes, offsets, samples };
}

test('decodes only a valid server-provided 128-bit playback key', () => {
  assert.deepEqual(playbackKey(wrapKey(keyHex)), key);
  assert.deepEqual(playbackKey(keyHex), key);
  for (const value of ['', 'not base64', '00', 'x'.repeat(9000)]) assert.throws(() => playbackKey(value));
});

test('CENC uses actual stco/stsc sample offsets, not sequential mdat guesses', () => {
  const fixture = encryptedFixture();
  const clear = decryptAudio(fixture.bytes, key);
  fixture.samples.forEach((sample, i) => assert.deepEqual(clear.subarray(fixture.offsets[i], fixture.offsets[i] + sample.length), sample));
  assert.equal(clear.includes(Buffer.from('enca')), false);
  assert.equal(clear.includes(Buffer.from('mp4a')), true);
  assert.equal(fixture.bytes.includes(Buffer.from('enca')), true, 'input must not be mutated');
});

test('corrupt sample tables and truncated files cannot trigger unchecked reads', () => {
  const fixture = encryptedFixture();
  const corrupt = Buffer.from(fixture.bytes);
  const stco = corrupt.indexOf(Buffer.from('stco'));
  corrupt.writeUInt32BE(0xffffffff, stco + 12);
  assert.throws(() => decryptAudio(corrupt, key));
  for (const size of [0, 4, 20, fixture.bytes.length - 5]) assert.throws(() => decryptAudio(fixture.bytes.subarray(0, size), key));
});

function payload(streams, rights) {
  return { track: { duration: 180000, label_info: { quality_map: rights } }, track_player: { video_model: JSON.stringify({ status: 10, message: 'success', video_duration: 180, video_list: streams }) } };
}
const stream = (quality, url = 'https://v3-luna.douyinvod.com/audio/file') => ({ main_url: Buffer.from(url).toString('base64'), video_meta: { quality, vtype: 'm4a', codec_type: 'aac', bitrate: 128000 }, encrypt_info: { encrypt: true, encryption_method: 'cenc-aes-ctr', spade_a: wrapKey(keyHex) } });
const free = { play_detail: { need_vip: false, need_purchase: false } };
const vip = { play_detail: { need_vip: true, need_purchase: false } };

test('reads track_player.video_model and base64 CDN URLs while respecting quality rights', () => {
  const selected = selectAudio(payload([stream('highest'), stream('medium')], { highest: vip, medium: free }), { quality: 'high', isVip: false });
  assert.equal(selected.quality, 'medium'); assert.equal(selected.url, 'https://v3-luna.douyinvod.com/audio/file');
  assert.deepEqual(selected.key, key);
});

test('VIP, purchase and missing authorization never fall through to an available URL', () => {
  for (const rights of [{ medium: vip }, { medium: { play_detail: { need_vip: false, need_purchase: true } } }, {}]) {
    assert.throws(() => selectAudio(payload([stream('medium')], rights), { quality: 'standard', isVip: false }));
  }
  const p = payload([stream('medium')], { medium: free }); p.risk_result = 1;
  assert.throws(() => selectAudio(p, { isVip: true }));
});

test('audio URLs and encrypted formats are validated before download', () => {
  for (const url of ['http://127.0.0.1/private', 'https://douyinvod.com.evil.test/private', 'file:///etc/passwd']) {
    assert.throws(() => selectAudio(payload([stream('medium', url)], { medium: free }), { isVip: false }));
  }
  const item = stream('medium'); item.encrypt_info.encryption_method = 'unknown';
  assert.throws(() => selectAudio(payload([item], { medium: free }), { isVip: false }));
});

test('a preview is not returned as a full-length stream', () => {
  const p = payload([stream('medium')], { medium: free }); p.track_player.video_model = JSON.stringify({ video_duration: 30, video_list: [stream('medium')] });
  assert.throws(() => selectAudio(p, { isVip: false }));
});
