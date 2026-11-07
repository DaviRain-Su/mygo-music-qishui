'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { selectAudio, decryptAudio, losslessAudio, audioURL, MAX_AUDIO_BYTES } = require('./audio.cjs');
const { fault } = require('./protocol.cjs');

async function downloadAudio(address, signal, fetcher = fetch) {
  let current = audioURL(address);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(current, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw fault('audio'); current = audioURL(new URL(location, current).href); continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) {
      await response.body?.cancel(); throw fault('audio');
    }
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > MAX_AUDIO_BYTES) throw fault('audio'); chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!size) throw fault('audio');
    return Buffer.concat(chunks);
  }
  throw fault('audio');
}
async function transcode(input, output, bitRate, signal, format = 'mp3') {
  if (!['mp3', 'flac'].includes(format)) throw fault('audio');
  let expectedPCMBytes;
  if (format === 'flac') {
    const source = losslessAudio(await fs.readFile(input));
    // STREAMINFO: 20-bit rate, 3-bit channels-1, 5-bit depth-1,
    // 36-bit total samples. Keep the original count: remuxing may rewrite it.
    const info = source.readBigUInt64BE(18);
    const samples = Number(info & ((1n << 36n) - 1n));
    const channels = Number((info >> 41n) & 7n) + 1;
    expectedPCMBytes = samples * channels * 4;
    // Unknown length cannot establish completeness. Bound decoded work as well
    // as compressed size; PCM is streamed and discarded, never written to disk.
    if (!samples || expectedPCMBytes > 512 * 1024 * 1024) throw fault('ffmpeg');
  }
  const commands = process.platform === 'darwin' ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'] : ['ffmpeg'];
  for (const command of commands) {
    if (signal.aborted) throw fault('timeout');
    const result = await new Promise(resolve => {
      const proc = spawn(command, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe',
        '-i', input, '-map', '0:a:0', '-vn', ...(format === 'flac' ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-b:a', bitRate + 'k']), '-map_metadata', '-1', '-fs', String(MAX_AUDIO_BYTES), '-f', format, output,
      ], { stdio: ['ignore', 'ignore', 'ignore'], shell: false });
      const kill = () => proc.kill('SIGKILL'); signal.addEventListener('abort', kill, { once: true });
      proc.once('error', error => { signal.removeEventListener('abort', kill); resolve({ missing: error.code === 'ENOENT' }); });
      proc.once('exit', code => { signal.removeEventListener('abort', kill); resolve({ code }); });
    });
    if (signal.aborted) throw fault('timeout');
    if (result.missing) continue;
    if (result.code !== 0) throw fault('ffmpeg');
    if (format === 'flac') await verifyFlac(command, output, expectedPCMBytes, signal);
    return;
  }
  throw fault('ffmpeg');
}
async function verifyFlac(command, file, expectedBytes, signal) {
  if (signal.aborted) throw fault('timeout');
  const valid = await new Promise(resolve => {
    let bytes = 0, overflow = false;
    const proc = spawn(command, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
      '-err_detect', 'crccheck+explode', '-protocol_whitelist', 'file,pipe',
      '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s32le', '-f', 's32le', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    const kill = () => proc.kill('SIGKILL');
    signal.addEventListener('abort', kill, { once: true });
    if (signal.aborted) kill();
    proc.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > expectedBytes) { overflow = true; kill(); }
    });
    proc.once('error', () => { signal.removeEventListener('abort', kill); resolve(false); });
    // close waits for stdout to drain, unlike exit.
    proc.once('close', code => {
      signal.removeEventListener('abort', kill);
      resolve(code === 0 && !overflow && bytes === expectedBytes);
    });
  });
  if (signal.aborted) throw fault('timeout');
  if (!valid) throw fault('ffmpeg');
}
const CACHE_LIMIT = 8;
const CACHE_TTL_MS = 30 * 60 * 1000;
class Playback {
  constructor({ dataDir, api, fetcher = fetch, encoder = transcode }) {
    this.dataDir = dataDir; this.api = api; this.fetcher = fetcher; this.encoder = encoder;
    this.cache = new Map(); this.pending = new Map(); this.controllers = new Set(); this.closed = false;
    this.directory = null;
  }
  async init() {
    if (!this.directory) this.directory = (async () => {
      const root = path.join(this.dataDir, 'audio-cache'); await fs.mkdir(root, { recursive: true, mode: 0o700 });
      // Remove only old directories created by this module, not arbitrary data or another session.
      for (const name of await fs.readdir(root)) {
        if (!/^run-[A-Za-z0-9]+$/.test(name)) continue;
        const old = path.join(root, name), stat = await fs.lstat(old);
        if (stat.isDirectory() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > 86400000) await fs.rm(old, { recursive: true, force: true });
      }
      const dir = await fs.mkdtemp(path.join(root, 'run-')); await fs.chmod(dir, 0o700); return dir;
    })();
    return this.directory;
  }
  async prepare({ id, quality = 'standard' } = {}) {
    if (this.closed || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw fault('protocol');
    if (!['standard', 'high', 'lossless'].includes(quality)) throw fault('protocol');
    const bitRate = quality === 'standard' ? 128 : 192, key = `${id}:${quality}:${quality === 'lossless' ? 'flac' : 'mp3'}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 2) throw fault('busy');
    const task = this.build(id, quality, bitRate, key).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  async build(id, quality, bitRate, cacheKey) {
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    let temporary, output, selected, stage = 'metadata';
    try {
      const root = await this.init();
      const check = () => { if (controller.signal.aborted || this.closed) throw fault('timeout'); };
      const [payload, me] = await Promise.all([
        this.api('/luna/pc/track_v2', {}, { track_id: id, media_type: 'track', queue_type: 'favorite_track_playlist', scene_name: 'library' }, controller.signal),
        this.api('/luna/pc/me', {}, undefined, controller.signal),
      ]); check();
      const profile = me.my_info || me.data?.my_info || me.data?.user || {};
      stage = 'entitlement'; selected = selectAudio(payload, { quality, isVip: profile.is_vip === true });
      stage = 'download'; const encrypted = await downloadAudio(selected.url, controller.signal, this.fetcher); check();
      stage = 'decrypt'; const clear = quality === 'lossless' ? losslessAudio(encrypted, selected.key) : selected.key ? decryptAudio(encrypted, selected.key) : encrypted;
      const format = quality === 'lossless' ? 'flac' : 'mp3';
      selected.key?.fill(0); check();
      temporary = await fs.mkdtemp(path.join(root, 'work-')); await fs.chmod(temporary, 0o700);
      const input = path.join(temporary, format === 'flac' ? 'audio.flac' : 'audio.m4a'); await fs.writeFile(input, clear, { mode: 0o600 });
      output = path.join(root, crypto.randomBytes(16).toString('hex') + '.' + format);
      await fs.writeFile(output, '', { mode: 0o600, flag: 'wx' });
      stage = 'encode'; await this.encoder(input, output, bitRate, controller.signal, format); check();
      stage = 'verify'; const stat = await fs.stat(output);
      if (stat.size < 1024 || stat.size >= MAX_AUDIO_BYTES) throw fault('ffmpeg');
      const handle = await fs.open(output, 'r'); const signature = Buffer.alloc(4);
      try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); }
      if (format === 'flac' ? signature.toString('ascii') !== 'fLaC' : signature.subarray(0, 3).toString('ascii') !== 'ID3' && !(signature[0] === 255 && (signature[1] & 224) === 224)) throw fault('ffmpeg');
      await fs.chmod(output, 0o600);
      const result = { url: pathToFileURL(output).href, type: format, size: stat.size, quality, ...(format === 'mp3' ? { bitRate: bitRate * 1000 } : {}) };
      const previous = this.cache.get(cacheKey);
      if (previous) await fs.rm(previous.file, { force: true }).catch(() => {});
      this.cache.delete(cacheKey); this.cache.set(cacheKey, { result, file: output, at: Date.now() });
      while (this.cache.size > CACHE_LIMIT) {
        const first = this.cache.keys().next().value, old = this.cache.get(first); this.cache.delete(first);
        await fs.rm(old.file, { force: true }).catch(() => {});
      }
      output = null; return result;
    } catch (error) {
      if (controller.signal.aborted) throw fault('timeout');
      if (['protocol', 'audio', 'entitlement', 'preview', 'ffmpeg', 'api', 'network', 'timeout'].includes(error?.code)) { error.stage = stage; throw error; }
      const safe = fault('audio'); safe.stage = stage; throw safe;
    } finally {
      selected?.key?.fill(0);
      clearTimeout(timer); this.controllers.delete(controller);
      if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
      if (output) await fs.rm(output, { force: true }).catch(() => {});
    }
  }
  async close() {
    this.closed = true; for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.pending.values()]);
    if (this.directory) await fs.rm(await this.directory, { recursive: true, force: true }).catch(() => {});
    this.cache.clear();
  }
}
module.exports = { Playback, downloadAudio, transcode };
