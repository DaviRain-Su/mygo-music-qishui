// MyGo Qishui: official browser SDK authentication runs in a private helper.
// No unsigned-fetch fallback, no default/placeholder successful account.
const VERSION = "0.3.0";
const t = typeof host.t === "function" ? (text) => host.t(text) : (text) => text;
const cookie = () => host.storage.get("authBackend") === "sdk-v1" ? host.storage.get("cookie") || "" : "";
function fail(code, message) { const error = new Error(message); error.code = code; return error; }
function needAccount() { if (!account()) throw fail("signIn", "请先使用官方 SDK 登录汽水音乐。"); }

// ---------- Private JSONL helper ----------
let helper = null, starting = null, signingIn = false;
const STAGES = new Set(["starting", "waiting-scan", "scanned", "verification", "verifying-account", "authenticated", "failed"]);
const ERROR_CODES = new Set(["setup", "protocol", "busy", "network", "timeout", "cancelled", "sdk", "integrity", "response", "session", "account", "api", "verification", "unavailable", "audio", "entitlement", "preview", "ffmpeg"]);
function diagnostic(stage, error) {
  const info = { version: VERSION, backend: "official-sdk", stage, at: new Date().toISOString() };
  if (Number.isInteger(error?.apiCode)) info.errorCode = error.apiCode;
  if (Number.isInteger(error?.httpStatus)) info.httpStatus = error.httpStatus;
  host.storage.set("loginDiagnostic", info);
  console.log("[qishui] login:", JSON.stringify(info));
}
function helperError(value) {
  const code = ERROR_CODES.has(value?.code) ? value.code : "protocol";
  const setup = ["setup", "integrity", "unavailable", "ffmpeg"].includes(code);
  const message = ERROR_CODES.has(value?.code) && typeof value.message === "string" && value.message.length <= 4000
    ? value.message : "汽水 SDK 辅助程序通信失败，请检查安装和进程权限。";
  const error = fail(setup ? "setup" : "qishui-" + code, message);
  if (Number.isInteger(value?.apiCode)) error.apiCode = value.apiCode;
  if (Number.isInteger(value?.httpStatus)) error.httpStatus = value.httpStatus;
  if (["metadata", "entitlement", "download", "decrypt", "encode", "verify"].includes(value?.stage)) error.stage = value.stage;
  return error;
}
function stopHelper(client, error) {
  if (client.closed) return;
  client.closed = true;
  if (helper === client) helper = null;
  for (const entry of client.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  client.pending.clear();
  try { client.process.kill(); } catch {}
}
async function pump(client) {
  try {
    for (;;) {
      const line = await client.process.readLine(); if (line === null) break;
      if (line.length > 4 * 1024 * 1024) throw helperError({ code: "protocol" });
      let packet;
      try { packet = JSON.parse(line); } catch { throw helperError({ code: "protocol" }); }
      if (packet.event === "fatal") throw helperError(packet.error);
      const entry = client.pending.get(packet.id); if (!entry) continue;
      if (packet.event === "prompt") {
        if (entry.onPrompt) entry.onPrompt(packet);
        continue;
      }
      if (typeof packet.ok !== "boolean") throw helperError({ code: "protocol" });
      clearTimeout(entry.timer); client.pending.delete(packet.id);
      if (packet.ok) entry.resolve(packet.result); else entry.reject(helperError(packet.error));
    }
    stopHelper(client, fail("qishui-helper", "汽水 SDK 辅助程序已退出，登录未完成。"));
  } catch (error) { stopHelper(client, error); }
}
function send(client, op, params = {}, timeout = 40000, onPrompt) {
  return new Promise((resolve, reject) => {
    if (client.closed) { reject(fail("qishui-helper", "汽水 SDK 辅助程序已停止。")); return; }
    const id = ++client.nextId;
    const timer = setTimeout(() => stopHelper(client, fail("qishui-timeout", "汽水 SDK 辅助程序等待超时，已停止本次操作。")), timeout);
    client.pending.set(id, { resolve, reject, timer, onPrompt });
    try { client.process.write(JSON.stringify({ id, op, params }) + "\n"); }
    catch { stopHelper(client, fail("qishui-helper", "无法向汽水 SDK 辅助程序发送请求。")); }
  });
}
async function ensureHelper() {
  if (helper && !helper.closed) return helper;
  if (starting) return starting;
  starting = (async () => {
    let process;
    for (const node of ["node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
      try { process = host.spawn(node, [host.dir + "/helper/launch.cjs", "--data-dir", host.dataDir + "/auth-sdk"]); break; } catch {}
    }
    if (!process) throw fail("setup", "汽水 SDK 登录需要 Node.js，以及插件设置中的启动程序权限。请先按 README 安装 helper 依赖并允许启动 Node。");
    const client = { process, pending: new Map(), nextId: 0, closed: false };
    helper = client; pump(client);
    const hello = await send(client, "hello", {}, 8000);
    if (hello?.protocol !== 1 || typeof hello.version !== "string") {
      const error = fail("setup", "汽水辅助程序版本不兼容，请重新安装 helper 依赖。"); stopHelper(client, error); throw error;
    }
    return client;
  })();
  try { return await starting; } finally { starting = null; }
}
function hasSession(value) {
  return typeof value === "string" && value.split(";").some((part) => {
    const at = part.indexOf("=");
    return at > 0 && ["sessionid", "sessionid_ss", "sid_guard", "sid_tt"].includes(part.slice(0, at).trim()) &&
      !["", "deleted", "null", "undefined"].includes(part.slice(at + 1).trim().toLowerCase());
  });
}
function verifiedResult(result) {
  return hasSession(result?.cookie) && typeof result?.account?.id === "string" && Boolean(result.account.id) &&
    typeof result?.account?.name === "string" && Boolean(result.account.name);
}
function progress(packet) {
  if (!STAGES.has(packet.stage) || typeof packet.text !== "string" || packet.text.length > 4000) throw helperError({ code: "protocol" });
  let qr;
  if (packet.qr !== undefined) {
    const url = new URL(packet.qr);
    if (url.origin !== "https://bff-pc.qishui.com" || !url.searchParams.get("token")) throw helperError({ code: "protocol" });
    qr = url.href;
  }
  diagnostic(packet.stage);
  host.signInPrompt({ ...(qr ? { qr } : {}), text: `[汽水 ${VERSION} SDK] ${packet.text}` });
}
export async function signIn() {
  if (signingIn) throw fail("qishui-busy", "已有登录正在进行，请先完成当前登录。");
  signingIn = true;
  try {
    diagnostic("starting");
    const client = await ensureHelper();
    const result = await send(client, "signIn", {}, 260000, progress);
    if (!verifiedResult(result)) throw fail("qishui-account", "辅助程序没有返回经过验证的登录会话和账号，未完成登录。");
    host.storage.set("account", result.account);
    host.storage.set("cookie", result.cookie);
    host.storage.set("authBackend", "sdk-v1");
    diagnostic("authenticated");
    return result.account;
  } catch (error) { diagnostic("failed", error); throw error; }
  finally { signingIn = false; }
}
export function account() {
  const me = host.storage.get("account");
  return cookie() && typeof me?.id === "string" && me.id && typeof me?.name === "string" && me.name ? me : null;
}
export async function signOut() {
  try { if (helper || cookie()) await send(await ensureHelper(), "signOut"); }
  finally { host.storage.remove("cookie"); host.storage.remove("account"); host.storage.remove("authBackend"); }
}
async function api(path, params, body) {
  needAccount();
  return send(await ensureHelper(), "request", { path, params: params || {}, ...(body !== undefined ? { body } : {}) });
}
// The helper, not this sandbox, owns stable SDK device/version parameters.
const lunaParams = (extra) => extra || {};

// ---------- Catalog mappings (still require live catalog/playback verification) ----------
const textOf = (v) => (typeof v === "string" ? v : v?.name || v?.title || "");
function artistsOf(raw) {
  const links = raw?.artist_links || raw?.artists || [];
  const out = links.map((a) => ({ id: String(a?.id || a?.artist_id || ""), name: textOf(a) })).filter((a) => a.name);
  if (!out.length) { const name = textOf(raw?.author) || textOf(raw?.artist_name); if (name) out.push({ id: "", name }); }
  return out;
}
function imageOf(value) {
  if (typeof value === "string") return /^https?:\/\//.test(value) ? value : "";
  if (!value || typeof value !== "object") return "";
  let url = (value.urls || value.url_list || [value.url]).find((s) => typeof s === "string" && /^https?:\/\//.test(s)) || "";
  if (url && value.uri && !url.includes(value.uri)) url += value.uri;
  return url && !url.includes("~") ? url + "~c5_375x375.jpg" : url;
}
function toTrack(raw, index, fallbackAlbum) {
  const entity = raw?.entity || raw?.data || raw;
  const media = entity?.media || entity || {};
  const wrapper = entity?.track_wrapper || media?.track_wrapper || raw?.track_wrapper;
  const track = wrapper?.track || media?.track_entity || raw?.track_entity || media?.track || raw?.track || entity;
  if (/^(playlist|album|artist|user|video|mix|radio)$/.test(raw?.type || "")) return null;
  const base = track?.base_info || raw?.base_info || raw?.base || track || {};
  const display = track?.display_info || raw?.display_info || media?.display_info || {};
  const related = track?.related_info || raw?.related_info || media?.related_info || {};
  const id = String(base.id || base.track_id || track?.id || track?.track_id || media.id || media.track_id || raw?.id || raw?.track_id || raw?.media_id || raw?.item_id || "");
  const name = textOf(base.name) || textOf(base.title) || textOf(track?.name) || textOf(media.name) || textOf(raw?.name) || textOf(raw?.title);
  if (!id || !name) return null;
  const albumLink = related.album_link || related.album || base.album || display.album || {};
  const albumName = textOf(albumLink.name) || textOf(albumLink.title) || textOf(base.album_name);
  const cover = imageOf(display.cover_url || display.url_cover || base.cover_url || albumLink.cover_url || albumLink.url_cover || track?.cover_url || media.cover_url || raw?.cover_url);
  return {
    id, name, artists: artistsOf(related.artist_links || related.artists ? related : base.artist_links || base.artists ? base : raw),
    album: { id: String(albumLink.id || ""), name: albumName, imageUrl: cover },
    duration: Number(base.duration_ms || base.duration || track?.duration_ms || track?.duration || media.duration || raw?.duration || 0),
    imageUrl: cover, albumId: String(albumLink.id || fallbackAlbum || ""),
  };
}
function toTracks(list, fallbackAlbum) { return (list || []).map((item, i) => toTrack(item, i, fallbackAlbum)).filter(Boolean); }
function deepFind(node, key, out = []) {
  if (Array.isArray(node)) for (const item of node) deepFind(item, key, out);
  else if (node && typeof node === "object") for (const k of Object.keys(node)) { if (k === key) out.push(node[k]); else deepFind(node[k], key, out); }
  return out;
}
function tracksFrom(payload) {
  const data = payload?.data ?? payload ?? {};
  const groups = data.result_groups || data.resultGroups || [];
  let raw = [];
  for (const g of groups) { const items = g.data || g.items || g.list; if (Array.isArray(items)) raw.push(...items); }
  if (!raw.length) raw = data.items || data.media_list || data.mediaList || data.tracks || [];
  if (!raw.length) raw = deepFind(data, "track") || [];
  return toTracks(raw);
}
export async function search({ query, kind, offset }) {
  if (kind !== "tracks") return { [kind]: [], more: false };
  needAccount();
  const res = await api("/luna/pc/search/track", lunaParams({ q: query, cursor: String(offset ?? 0), count: 20, search_method: "input" }));
  const tracks = tracksFrom(res); return { tracks, more: tracks.length >= 20 };
}
export async function suggest() { return []; }
export async function home() {
  needAccount();
  const tracks = tracksFrom(await api("/luna/pc/feed/song-tab", {}, {
    is_first_request: true, played_media: [], is_did_first_request: false, feed_counts: { mix_session_count: 1 },
  }));
  return { title: t("Home"), sections: tracks.length ? [{ title: t("Recommended for you"), tracks }] : [] };
}
export async function playlists() {
  if (!cookie()) return [];
  const res = await api("/luna/pc/user/playlist", lunaParams({ user_id: account().id, cursor: 0, count: 30 }));
  const data = res?.data ?? res ?? {}, list = data.list || data.playlists || [];
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({ id: String(pPlaylistId(p)), name: textOf(p.name || p.title || p.list_name), trackCount: Number(p.track_count || p.song_count || 0), mine: Boolean(p.is_own || p.own) })).filter((p) => p.id && p.name);
}
function pPlaylistId(p) { return p.playlist_id || p.id || p.collection_id || ""; }
export async function playlist({ id }) {
  needAccount();
  const res = await api("/luna/pc/playlist/detail", lunaParams({ playlist_id: id, cursor: 0, count: 100 }));
  const data = res?.data ?? {}, info = data.playlist || data.info || {};
  return { id, name: textOf(info.name || info.title), tracks: tracksFrom(res), trackCount: Number(info.track_count || 0) };
}
export async function liked({ offset }) {
  needAccount();
  const tracks = tracksFrom(await api("/luna/pc/me/collection/mixed", lunaParams({ cursor: offset ?? 0, count: 30 })));
  return { tracks, more: tracks.length >= 30 };
}

// ---------- Playback: the helper resolves rights, decrypts authorized audio and prepares MP3 ----------
export async function stream({ id, quality = "standard" }) {
  needAccount();
  let result;
  try { result = await send(await ensureHelper(), "stream", { id, quality }, 28000); }
  catch (error) {
    host.storage.set("playbackDiagnostic", {
      version: VERSION, status: "failed", ...(error.stage ? { stage: error.stage } : {}),
      ...(Number.isInteger(error.apiCode) ? { errorCode: error.apiCode } : {}),
    });
    throw error;
  }
  let url;
  try { url = new URL(result?.url); } catch { throw fail("unavailable", "汽水辅助程序没有返回有效音频。"); }
  const expected = host.dataDir.replace(/\/$/, "") + "/auth-sdk/audio-cache/";
  const file = decodeURIComponent(url.pathname);
  if (url.protocol !== "file:" || url.hostname || url.search || url.hash || !file.startsWith(expected) ||
      !/^run-[A-Za-z0-9]+\/[a-f0-9]{32}\.mp3$/.test(file.slice(expected.length)) ||
      result.type !== "mp3" || !Number.isSafeInteger(result.size) || result.size <= 0) {
    throw fail("unavailable", "汽水辅助程序返回了无法验证的音频文件。");
  }
  host.storage.set("playbackDiagnostic", { version: VERSION, status: "prepared", size: result.size });
  return { url: url.href, type: "mp3", size: result.size, quality: result.quality, bitRate: result.bitRate };
}
