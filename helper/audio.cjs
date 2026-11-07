'use strict';
const crypto = require('node:crypto');
const { fault } = require('./protocol.cjs');
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLES = 200000;
const reject = () => { throw fault('audio'); };

// Service-provided spade_a is a transport encoding of the session's playback key.
// No fixed keys, entitlement changes or key values in logs/argv/files.
function playbackKey(value) {
  if (typeof value !== 'string' || value.length > 8192) return reject();
  if (/^[a-f0-9]{32}$/i.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return reject();
  const source = Buffer.from(value, 'base64');
  if (source.length < 4) return reject();
  const padding = (source[0] ^ source[1] ^ source[2]) - 48;
  if (padding < 0 || padding > source.length - 3) return reject();
  const coded = source.subarray(1, source.length - padding), plain = Buffer.alloc(coded.length);
  for (let i = 0; i < coded.length; i++) {
    let count = 0; for (let bits = i; bits; bits >>>= 1) count += bits & 1;
    const previous = i < 2 ? [250, 85][i] : coded[i - 2];
    let byte = (coded[i] ^ previous) - count - 21;
    while (byte < 0) byte += 255;
    plain[i] = byte & 255;
  }
  const leading = String.fromCharCode(plain[0]);
  if (!/^[0-9a-z]$/.test(leading)) return reject();
  const tail = Number.parseInt(leading, 36);
  const text = plain.subarray(1, plain.length - tail).toString('ascii');
  if (!/^[a-f0-9]{32}$/i.test(text)) return reject();
  return Buffer.from(text, 'hex');
}
function audioURL(value) {
  if (typeof value !== 'string' || value.length > 32768) return reject();
  const text = value.startsWith('https://') ? value : Buffer.from(value, 'base64').toString('utf8');
  let url; try { url = new URL(text); } catch { return reject(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'douyinvod.com' || url.hostname.endsWith('.douyinvod.com'))) return reject();
  return url.href;
}
function selectAudio(payload, { quality = 'standard', isVip = false } = {}) {
  const data = payload?.data || payload;
  if (!data || Number(data.risk_result || 0) !== 0) throw fault('entitlement');
  const track = data.track || {}, player = data.track_player || {};
  const labels = track.label_info || {};
  if (labels.only_vip_playable === true && !isVip) throw fault('entitlement');
  const rights = labels.quality_map || {};
  let model = player.video_model;
  try { if (typeof model === 'string') model = JSON.parse(model.startsWith('{') ? model : Buffer.from(model, 'base64').toString('utf8')); }
  catch { return reject(); }
  if (!model || !Array.isArray(model.video_list) || model.video_list.length > 50 ||
      ![0, 10].includes(Number(model.status || 0)) || (Number(model.status) === 10 && model.message !== 'success')) return reject();
  if (Number(model.video_duration) > 0 && Number(track.duration) > 0 && Number(model.video_duration) * 1000 + 5000 < Number(track.duration)) throw fault('preview');
  const ranks = quality === 'lossless' ? ['lossless', 'sq', 'highest', 'higher', 'medium'] : quality === 'standard' ? ['medium', 'higher', 'highest'] : ['highest', 'higher', 'medium'];
  const options = model.video_list.filter(item => {
    const meta = item.video_meta || {}, permission = rights[meta.quality]?.play_detail;
    return ranks.includes(meta.quality) && (quality === 'lossless' ? ['flac'] : ['aac', 'mp4a']).includes(String(meta.codec_type).toLowerCase()) &&
      (quality === 'lossless' ? ['m4a', 'mp4', 'flac'] : ['m4a', 'mp4']).includes(meta.vtype) && permission &&
      (permission.need_vip === false || (permission.need_vip === true && isVip)) && permission.need_purchase === false;
  }).sort((a, b) => ranks.indexOf(a.video_meta.quality) - ranks.indexOf(b.video_meta.quality));
  if (!options.length) {
    if (quality === 'lossless' && !model.video_list.some(item => String(item.video_meta?.codec_type).toLowerCase() === 'flac')) return reject();
    throw fault('entitlement');
  }
  const item = options[0], encryption = item.encrypt_info || {};
  if (encryption.encrypt && encryption.encryption_method !== 'cenc-aes-ctr') return reject();
  return {
    url: audioURL(item.main_url), key: encryption.encrypt ? playbackKey(encryption.spade_a) : null,
    quality: item.video_meta.quality, duration: Number(track.duration) || 0,
    size: Number(item.video_meta.size) || 0, type: item.video_meta.vtype === 'flac' ? 'flac' : 'm4a',
  };
}

// Non-fragmented ISO BMFF CENC audio: preserve file offsets and decrypt at sample boundaries.
function parseAudio(input, key, lossless = false) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_AUDIO_BYTES || (key !== null && (!Buffer.isBuffer(key) || key.length !== 16))) return reject();
  const output = Buffer.from(input); let flacOutput;
  function boxes(start, end) {
    const result = [];
    for (let at = start; at < end;) {
      if (at + 8 > end || result.length >= 10000) return reject();
      let size = input.readUInt32BE(at), header = 8;
      if (size === 1) {
        if (at + 16 > end) return reject();
        const wide = input.readBigUInt64BE(at + 8); if (wide > BigInt(MAX_AUDIO_BYTES)) return reject();
        size = Number(wide); header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return reject();
      result.push({ type: input.toString('ascii', at + 4, at + 8), at, data: at + header, end: at + size }); at += size;
    }
    return result;
  }
  const find = (items, name) => items.find(box => box.type === name) || reject();
  const children = box => boxes(box.data, box.end);
  const u32 = (box, relative) => { if (relative < 0 || box.data + relative + 4 > box.end) return reject(); return input.readUInt32BE(box.data + relative); };
  const top = boxes(0, input.length);
  if (top.some(box => box.type === 'moof')) return reject();
  const moov = find(top, 'moov'), mdats = top.filter(box => box.type === 'mdat');
  if (!mdats.length) return reject();
  const moovChildren = children(moov); let audioTracks = 0;
  for (const trak of moovChildren.filter(box => box.type === 'trak')) {
    const mdia = find(children(trak), 'mdia'), mdiaChildren = children(mdia), handler = find(mdiaChildren, 'hdlr');
    if (handler.data + 12 > handler.end) return reject();
    if (input.toString('ascii', handler.data + 8, handler.data + 12) !== 'soun') continue;
    if (++audioTracks > 1) return reject();
    const stbl = find(children(find(mdiaChildren, 'minf')), 'stbl'), tables = children(stbl);
    const stsd = find(tables, 'stsd');
    if (u32(stsd, 4) !== 1) return reject();
    const entries = boxes(stsd.data + 8, stsd.end);
    if (entries.length !== 1) return reject();
    const entry = entries[0];
    if (entry.type !== (key ? 'enca' : 'fLaC')) return reject();
    if (entry.data + 28 > entry.end || input.readUInt16BE(entry.data + 8) !== 0) return reject();
    const extensions = boxes(entry.data + 28, entry.end);
    let sinf, format = entry.type;
    if (key) {
      sinf = find(extensions, 'sinf');
      const protection = children(sinf), frma = find(protection, 'frma'), schm = find(protection, 'schm');
      if (frma.end - frma.data !== 4 || u32(schm, 0) !== 0 ||
          schm.end - schm.data !== 12 || input.toString('ascii', schm.data + 4, schm.data + 8) !== 'cenc') return reject();
      format = input.toString('ascii', frma.data, frma.end);
    }
    if (format !== (lossless ? 'fLaC' : 'mp4a')) return reject();
    let metadata;
    if (lossless) {
      const dfla = find(extensions, 'dfLa');
      if (u32(dfla, 0) !== 0) return reject();
      metadata = input.subarray(dfla.data + 4, dfla.end);
      validateFlacMetadata(metadata, true);
    }
    const stsz = find(tables, 'stsz'), sampleSize = u32(stsz, 4), count = u32(stsz, 8);
    if (!count || count > MAX_SAMPLES) return reject();
    const sizes = Array.from({ length: count }, (_, i) => sampleSize || u32(stsz, 12 + i * 4));
    if (sizes.some(size => !size || size > MAX_AUDIO_BYTES)) return reject();
    const stsc = find(tables, 'stsc'), groups = u32(stsc, 4);
    if (!groups || groups > count) return reject();
    const runs = Array.from({ length: groups }, (_, i) => ({ first: u32(stsc, 8 + i * 12), samples: u32(stsc, 12 + i * 12), index: u32(stsc, 16 + i * 12) }));
    if (runs[0].first !== 1 || runs.some((r, i) => !r.samples || r.index !== 1 || (i && r.first <= runs[i - 1].first))) return reject();
    const chunks = tables.find(box => box.type === 'stco') || find(tables, 'co64'), chunkCount = u32(chunks, 4);
    if (!chunkCount || chunkCount > count) return reject();
    const senc = key ? (tables.find(box => box.type === 'senc') || find(moovChildren, 'senc')) : null;
    if (key && (u32(senc, 0) !== 0 || u32(senc, 4) !== count)) return reject();
    const ivSize = key ? (senc.end - senc.data - 8) / count : 8;
    if (ivSize !== 8 && ivSize !== 16) return reject();
    if (runs.some(r => r.first > chunkCount)) return reject();
    const clearSamples = [];
    let sample = 0, run = 0, previousEnd = 0;
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      while (run + 1 < runs.length && runs[run + 1].first <= chunk + 1) run++;
      let offset;
      if (chunks.type === 'stco') offset = u32(chunks, 8 + chunk * 4);
      else {
        const pos = chunks.data + 8 + chunk * 8; if (pos + 8 > chunks.end) return reject();
        const value = input.readBigUInt64BE(pos); if (value > BigInt(input.length)) return reject(); offset = Number(value);
      }
      for (let n = 0; n < runs[run].samples; n++, sample++) {
        if (sample >= count) return reject();
        const size = sizes[sample];
        if (offset < previousEnd || !mdats.some(box => offset >= box.data && offset + size <= box.end)) return reject();
        let clear = input.subarray(offset, offset + size);
        if (key) {
          const iv = Buffer.alloc(16); input.copy(iv, 0, senc.data + 8 + sample * ivSize, senc.data + 8 + (sample + 1) * ivSize);
          const decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);
          clear = Buffer.concat([decipher.update(input.subarray(offset, offset + size)), decipher.final()]);
        }
        if (lossless) clearSamples.push(clear);
        clear.copy(output, offset); previousEnd = offset + size; offset += size;
      }
    }
    if (sample !== count) return reject();
    if (lossless) flacOutput = Buffer.concat([Buffer.from('fLaC'), metadata, ...clearSamples]);
    output.write(format, entry.at + 4, 'ascii');
    for (const box of [sinf, senc, ...tables.filter(box => ['saio', 'saiz'].includes(box.type))].filter(Boolean)) output.write('free', box.at + 4, 'ascii');
  }
  if (audioTracks !== 1) return reject();
  return lossless ? flacOutput : output;
}
// Require a complete metadata chain beginning with a 34-byte STREAMINFO block.
function validateFlacMetadata(data, exact = false) {
  let at = 0, first = true;
  for (let blocks = 0; blocks < 128; blocks++) {
    if (at + 4 > data.length) return reject();
    const kind = data[at] & 127, last = data[at] & 128, size = data.readUIntBE(at + 1, 3);
    if ((first && (kind !== 0 || size !== 34)) || (!first && kind === 0) || kind === 127 || at + 4 + size > data.length) return reject();
    at += 4 + size; first = false;
    if (last) { if (exact ? at !== data.length : at >= data.length) return reject(); return at; }
  }
  return reject();
}
function decryptAudio(input, key) {
  if (!Buffer.isBuffer(key) || key.length !== 16) return reject();
  return parseAudio(input, key);
}
function losslessAudio(input, key = null) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_AUDIO_BYTES) return reject();
  if (!key && input.subarray(0, 4).toString('ascii') === 'fLaC') {
    validateFlacMetadata(input.subarray(4));
    return Buffer.from(input);
  }
  return parseAudio(input, key, true);
}
module.exports = { MAX_AUDIO_BYTES, losslessAudio, playbackKey, decryptAudio, selectAudio, audioURL };
