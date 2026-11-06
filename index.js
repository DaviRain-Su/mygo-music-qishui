// 汽水音乐（Soda Music）插件 for MyGo Music
//
// 走汽水 PC 客户端的 luna 协议：
//   - 扫码登录：passport 接口（抖音 App 扫码）
//   - 搜索 / 播放：luna 数据接口，带登录 cookie
//   - 音频流是 AAC（MP4 容器），app 只解码 mp3/flac/ogg，
//     所以由 ffmpeg 转成 MP3 并以本地 HTTP 服务给出——
//     与官方 YouTube Music 插件同一做法。
//
// 参考：
//   https://github.com/egoist/mygo-music-youtube-music （插件写法）
//   https://github.com/2706521883-lgtm/folia-qishui   （汽水协议）

const site = "https://api.qishui.com";

// 汽色接口认 UA：没有合适的 UA 会拿到空响应
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.5.2 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 Safari/537.36";

// What the plugin says is in the listener's language, from locales/zh-CN.json.
// 旧版 app（< 0.1.8）没有 host.t，退回原文。
const t = host.t || ((s) => s);

// ---------- 基础 ----------

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 登录态：Cookie 头，原样存取
const cookie = () => host.storage.get("cookie") || "";

function needAccount() {
  if (!cookie()) throw fail("signIn");
}

// 设备号：装一次定一个，之后不变（协议要求带）
function deviceId() {
  let id = host.storage.get("deviceId");
  if (!id) {
    id = "7" + String(Math.floor(Math.random() * 1e18)).padStart(18, "0");
    host.storage.set("deviceId", id);
  }
  return id;
}

// 程序在不在：能跑 --version 就是在
async function program(name, ...args) {
  try {
    const proc = host.spawn(name, args);
    proc.closeStdin();
    await proc.wait();
    return name;
  } catch {
    return null;
  }
}

// ---------- 接口 ----------

// 带登录态的请求。method 是 GET（默认）或 POST。
async function api(pathname, params, body) {
  const url = new URL(pathname, site);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "User-Agent": UA,
      cookie: cookie(),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    host.storage.remove("cookie");
    throw fail("signIn", t("Your Qishui session has ended: sign in again"));
  }
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
  return res.json();
}

// 登录态接口的公共参数（对齐汽色 PC 客户端 3.3.0）
function lunaParams(extra) {
  const now = Date.now();
  return {
    aid: "386088",
    app_name: "luna_pc",
    region: "cn",
    device_id: deviceId(),
    iid: String(now),
    version_name: "3.3.0",
    version_code: "30030000",
    channel: "official",
    device_platform: "windows",
    device_type: "Windows",
    os_version: "Windows 11",
    ac: "wifi",
    ...extra,
  };
}

// ---------- 扫码登录 ----------

// 二维码内容：由 token 拼出扫码跳转链接（协议要求带 os / computer_name）
function scanUrlOf(token) {
  const u = new URL("https://bff-pc.qishui.com/light/invoke/scan_login");
  u.searchParams.set("token", token);
  u.searchParams.set("os", "Windows");
  u.searchParams.set("computer_name", "MyGo-Music");
  return u.toString();
}

async function getQrCode() {
  const res = await api("/passport/web/get_qrcode/", {
    aid: 386088,
    passport_jssdk_version: "2.4.13",
    is_from_ttaccountsdk: 1,
    language: "zh",
    device_id: deviceId(),
    install_id: deviceId(),
    device_platform: "PC",
    version_code: "3520",
    next: "https://api.qishui.com",
    need_logo: "false",
    need_short_url: "false",
  });
  if (!res?.data?.token) throw new Error(t("Couldn't get a QR code: try again"));
  // csrf token 之类要跨请求保持
  rememberCookies(res);
  return { token: res.data.token, qr: res.data.qrcode_index_url };
}

// Cookie 罐：passport 接口的 csrf token 要跨请求保持
const jar = new Map();

function rememberCookies(res) {
  const lines = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = String(line).split(";")[0];
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
}

const cookiesAsHeader = (pairs) =>
  Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

const parseCookieString = (raw) => {
  const out = {};
  for (const part of String(raw || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
};

// 问一次扫码状态；确认后从 Set-Cookie 头收登录 cookie
async function checkQr(token) {
  const url = new URL("/passport/web/check_qrconnect/", site);
  url.searchParams.set("aid", "386088");
  url.searchParams.set("device_platform", "PC");
  url.searchParams.set("version_code", "3520");
  url.searchParams.set("next", "https://api.qishui.com");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: new URLSearchParams({
      token,
      need_logo: "false",
      need_short_url: "false",
      is_frontier: "true",
      is_new_login: "1",
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  const d = data?.data ?? {};
  console.log("[qishui] check:", JSON.stringify(d).slice(0, 300));
  // 确认了的信号：status 3 / 响应体带 cookie / 带 redirect_url / Set-Cookie 里有会话
  const cookies = cookiesFromResponse(res);
  if (d.session_cookie) Object.assign(cookies, parseCookieString(d.session_cookie));
  const confirmed =
    String(d.status) === "3" ||
    d.session_cookie ||
    d.redirect_url ||
    Object.keys(cookies).some((name) => /^(sessionid|sid_guard|sid_tt)/i.test(name));
  if (!confirmed) return { done: false };
  return { done: true, cookie: cookiesAsHeader(cookies) };
}

// ---------- 账号 ----------

export async function signIn() {
  const qr = await getQrCode();
  host.signInPrompt({
    qr: scanUrlOf(qr.token),
    text: t("Scan the code with the Douyin app to sign in to Qishui"),
  });

  // 三分钟内每两秒问一次
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const { done, cookie: session } = await checkQr(qr.token);
    if (done && session) {
      host.storage.set("cookie", session);
      return account() || { id: "qishui", name: "Qishui" };
    }
  }
  throw new Error(t("Signing in took too long: try again"));
}
export async function account() {
  if (!cookie()) return null;
  try {
    const r = await api("/luna/pc/me", lunaParams({}));
    const data = r?.data ?? {};
    const name = data.nickname || data.name || data.user_name || "";
    return {
      id: String(data.user_id || data.uid || "qishui"),
      name: name || "Qishui",
      imageUrl: data.avatar_url || data.image_url || undefined,
    };
  } catch (e) {
    if (e.code === "signIn") throw e;
    // 拿不到资料不算掉线
    return { id: "qishui", name: "Qishui" };
  }
}

export function signOut() {
  host.storage.remove("cookie");
}

// ---------- 曲目：汽水对象转 app 的格式 ----------

const textOf = (v) => (typeof v === "string" ? v : v?.name || v?.title || "");

function artistsOf(raw) {
  const links = raw?.artist_links || raw?.artists || [];
  const out = links
    .map((a) => ({ id: String(a?.id || a?.artist_id || ""), name: textOf(a) }))
    .filter((a) => a.name);
  if (!out.length) {
    const name = textOf(raw?.author) || textOf(raw?.artist_name);
    if (name) out.push({ id: "", name });
  }
  return out;
}

function toTrack(raw, index, fallbackAlbum) {
  const base = raw?.base_info || raw?.base || {};
  const entity = raw?.entity || raw?.data || raw;
  const media = entity?.media || entity || {};
  const track = media?.track || raw?.track || entity;
  const display = raw?.display_info || media?.display_info || {};
  const related = raw?.related_info || media?.related_info || {};

  const id = String(
    base.id || base.track_id || track?.id || track?.track_id ||
    media.id || media.track_id || raw?.id || raw?.track_id ||
    raw?.media_id || raw?.item_id || ""
  );
  const name =
    textOf(base.name) || textOf(base.title) || textOf(track?.name) ||
    textOf(media.name) || textOf(raw?.name) || textOf(raw?.title);
  if (!id || !name) return null;

  const albumLink = related.album_link || related.album || base.album || display.album || {};
  const albumName = textOf(albumLink.name) || textOf(albumLink.title) || textOf(base.album_name);
  const cover =
    display.cover_url || base.cover_url || albumLink.cover_url ||
    track?.cover_url || media.cover_url || raw?.cover_url || "";

  const durationMs =
    Number(base.duration || track?.duration || media.duration || raw?.duration || 0) * 1000;

  return {
    id,
    name,
    artists: artistsOf(related.artist_links ? related : base.artist_links ? base : raw),
    album: { id: String(albumLink.id || ""), name: albumName, imageUrl: cover },
    duration: durationMs,
    imageUrl: cover,
    albumId: String(albumLink.id || fallbackAlbum || ""),
  };
}

function toTracks(list, fallbackAlbum) {
  return (list || [])
    .map((item, i) => toTrack(item, i, fallbackAlbum))
    .filter(Boolean);
}

// 应答里凡是数组都翻一遍，找出像曲目的（汽水的应答层级深且不固定）
function deepFind(node, key, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) deepFind(item, key, out);
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (k === key) out.push(node[k]);
      else deepFind(node[k], key, out);
    }
  }
  return out;
}

function tracksFrom(payload) {
  // 搜索：data.result_groups[].data[]；歌单/专辑：data.media_list 或 data.tracks
  const data = payload?.data ?? payload ?? {};
  const groups = data.result_groups || data.resultGroups || [];
  let raw = [];
  for (const g of groups) raw.push(...(g.data || g.items || g.list || []));
  if (!raw.length) raw = data.media_list || data.mediaList || data.tracks || [];
  if (!raw.length) raw = deepFind(data, "track") || [];
  return toTracks(raw);
}

// ---------- 搜索 ----------

export async function search({ query, kind, offset }) {
  if (kind !== "tracks") return { [kind]: [], more: false };
  needAccount();
  const res = await api("/luna/pc/search/track", lunaParams({
    q: query,
    cursor: String(offset ?? 0),
    count: 20,
    search_method: "input",
  }));
  const tracks = tracksFrom(res);
  return { tracks, more: tracks.length >= 20 };
}

export async function suggest({ query }) {
  // 汽色的搜索联想接口未公开文档化；没有就空着
  return [];
}

// ---------- 首页 ----------

export async function home() {
  needAccount();
  const res = await api("/luna/pc/feed/song-tab", lunaParams({
    cursor: 0,
    cnt: 30,
    count: 30,
  }));
  const tracks = tracksFrom(res);
  return {
    title: t("Home"),
    sections: tracks.length
      ? [{ title: t("Recommended for you"), tracks }]
      : [],
  };
}

// ---------- 歌单 ----------

export async function playlists() {
  if (!cookie()) return [];
  const res = await api("/luna/pc/user/playlist", lunaParams({}));
  const data = res?.data ?? {};
  const list = data.list || data.playlists || data.data || [];
  return list
    .map((p) => ({
      id: String(pPlaylistId(p)),
      name: textOf(p.name || p.title || p.list_name),
      trackCount: Number(p.track_count || p.song_count || 0),
      mine: Boolean(p.is_own || p.own),
    }))
    .filter((p) => p.id && p.name);
}

function pPlaylistId(p) {
  return p.playlist_id || p.id || p.collection_id || "";
}

export async function playlist({ id }) {
  needAccount();
  const res = await api("/luna/pc/playlist/detail", lunaParams({
    playlist_id: id,
    cursor: 0,
    count: 100,
  }));
  const data = res?.data ?? {};
  const info = data.playlist || data.info || {};
  return {
    id,
    name: textOf(info.name || info.title),
    tracks: tracksFrom(res),
    trackCount: Number(info.track_count || 0),
  };
}

// ---------- 喜欢 ----------

export async function liked({ offset }) {
  needAccount();
  const res = await api("/luna/pc/me/collection/mixed", lunaParams({
    cursor: offset ?? 0,
    count: 30,
  }));
  const tracks = tracksFrom(res);
  return { tracks, more: tracks.length >= 30 };
}

// ---------- 播放 ----------

// ffmpeg 自己起一个本地 HTTP 服务，边拉边转，app 来取的就是 MP3。
const serving = [];
const servingAtMost = 3;
const servedWithin = 10 * 60 * 1000;

function stopWaiting() {
  while (serving.length >= servingAtMost) serving.shift().kill();
}

async function serve(sourceUrl, bitRate) {
  const ffmpeg = await program("ffmpeg", "-version");
  if (!ffmpeg) {
    throw fail("setup", t("Qishui plays through ffmpeg: install it with Homebrew, or so that it's on the PATH"));
  }
  stopWaiting();
  const port = 20000 + Math.floor(Math.random() * 40000);
  const proc = host.spawn(ffmpeg, [
    "-nostdin", "-hide_banner", "-nostats",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-rw_timeout", "15000000",
    "-user_agent", UA,
    "-i", sourceUrl,
    "-vn", "-c:a", "libmp3lame", "-b:a", `${bitRate}k`, "-id3v2_version", "0", "-write_xing", "0",
    "-f", "mp3", "-listen", "1", `http://127.0.0.1:${port}/`,
  ]);
  proc.closeStdin();
  serving.push(proc);
  const timer = setTimeout(() => proc.kill(), servedWithin);
  proc.wait().then(() => {
    clearTimeout(timer);
    const at = serving.indexOf(proc);
    if (at >= 0) serving.splice(at, 1);
  });
  // It says what it's reading right before it opens the port.
  const until = Date.now() + 15000;
  while (!proc.errorOutput().includes("Input #0")) {
    if (Date.now() > until) {
      proc.kill();
      throw new Error(t("the audio didn't start in time"));
    }
    await sleep(30);
  }
  await sleep(100);
  return `http://127.0.0.1:${port}/`;
}

// 一首歌的播放地址：track_v2 应答里的各个流，挑一个能用的
function streamUrlOf(payload) {
  const data = payload?.data ?? payload ?? {};
  // audio_info.play_info_list[].url
  const audio = data.audio_info || data.audioInfo || {};
  const list = audio.play_info_list || audio.playInfoList || [];
  for (const item of list) {
    const url = item.url || item.main_play_url || item.main_url || item.play_url;
    if (url) return url;
  }
  // 兜底：各处直接给的地址
  return (
    data.play_url || data.main_play_url || data.main_url ||
    data.track?.play_url || data.track?.main_play_url || ""
  );
}

export async function stream({ id, quality }) {
  needAccount();
  const res = await api("/luna/pc/track_v2", lunaParams({
    track_id: id,
    media_type: "track",
  }));
  const url = streamUrlOf(res);
  if (!url) throw fail("unavailable", t("No playable audio for this track"));
  const kbps = quality === "standard" ? 128 : 192;
  const served = await serve(url, kbps);
  return {
    url: served,
    type: "mp3",
    quality: kbps === 128 ? "standard" : "high",
    bitRate: kbps * 1000,
  };
}
