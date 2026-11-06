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

// 汽水接口使用的客户端 UA。
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.5.2 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 Safari/537.36";

// What the plugin says is in the listener's language, from locales/zh-CN.json.
// 旧版 app（< 0.1.8）没有 host.t，退回原文。
const t = typeof host.t === "function" ? (s) => host.t(s) : (s) => s;

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

const loginVersion = "0.1.1";
const sessionNames = ["sessionid", "sessionid_ss", "sid_guard", "sid_tt"];
let signingIn = false;

// Each attempt owns its cookie jar. Never mix an old login or catalog request into it.
function loginURL(address) {
  let url;
  try { url = new URL(address, site); } catch {
    throw fail("qishui-redirect", "汽水返回了无效的登录跳转地址。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "qishui.com" || url.hostname.endsWith(".qishui.com"))) {
    throw fail("qishui-redirect", "汽水登录跳转超出插件授权范围，已停止，未发送登录凭据。");
  }
  return url;
}

function rememberCookies(jar, response, address) {
  const headers = response.headers;
  const lines = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=\s*[^=;,\s]+=)/);
  for (const line of lines) {
    const [pair, ...attributes] = line.split(";");
    const at = pair.indexOf("=");
    if (at < 1) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\x00-\x20\x7f]/.test(value)) continue;
    let domain = address.hostname, hostOnly = true, secure = false, expires = Infinity;
    let path = address.pathname.slice(0, address.pathname.lastIndexOf("/")) || "/";
    let maxAge = null;
    for (const attribute of attributes) {
      const split = attribute.indexOf("=");
      const key = (split < 0 ? attribute : attribute.slice(0, split)).trim().toLowerCase();
      const val = split < 0 ? "" : attribute.slice(split + 1).trim();
      if (key === "domain") { domain = val.toLowerCase().replace(/^\./, ""); hostOnly = false; }
      if (key === "path" && val.startsWith("/")) path = val;
      if (key === "secure") secure = true;
      if (key === "max-age" && /^-?\d+$/.test(val)) maxAge = Number(val);
      if (key === "expires" && Number.isFinite(Date.parse(val))) expires = Date.parse(val);
    }
    if (!(domain === "qishui.com" || domain.endsWith(".qishui.com")) ||
        !(address.hostname === domain || address.hostname.endsWith("." + domain))) continue;
    if (maxAge !== null) expires = Date.now() + maxAge * 1000;
    const key = `${domain}\n${path}\n${name}`;
    if (!value || expires <= Date.now()) jar.delete(key);
    else jar.set(key, { name, value, domain, hostOnly, path, secure, expires });
  }
}

function cookiesAsHeader(jar, address = new URL(site)) {
  // Object.entries(new Map()) is always empty: iterate the Map itself.
  return [...jar.values()].filter((c) => c.expires > Date.now() &&
    (address.hostname === c.domain || (!c.hostOnly && address.hostname.endsWith("." + c.domain))) &&
    (address.pathname === c.path || address.pathname.startsWith(c.path.endsWith("/") ? c.path : c.path + "/")) &&
    (!c.secure || address.protocol === "https:"))
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`).join("; ");
}

function hasSessionCookie(header) {
  return header.split(";").some((part) => {
    const at = part.indexOf("=");
    return at > 0 && sessionNames.includes(part.slice(0, at).trim()) &&
      !["", "deleted", "null", "undefined"].includes(part.slice(at + 1).trim().toLowerCase());
  });
}

// Only allowlisted, non-sensitive metadata is persisted or printed. No raw response JSON.
function loginDiagnostic(stage, { status, errorCode, httpStatus, reason } = {}) {
  const info = { version: loginVersion, stage, at: new Date().toISOString() };
  const previous = host.storage.get("loginDiagnostic");
  if (stage === "failed" && previous?.stage === "poll") info.status = previous.status;
  if (typeof reason === "string" && /^qishui-[a-z-]{1,32}$/.test(reason)) info.reason = reason;
  if (status !== undefined) {
    const known = ["new", "scanned", "scaned", "confirmed", "expired", "rejected", "cancelled", "canceled", "1", "2", "3", "4", "5"];
    info.status = known.includes(String(status)) ? String(status) : "unknown";
  }
  if (Number.isFinite(errorCode)) info.errorCode = errorCode;
  if (Number.isFinite(httpStatus)) info.httpStatus = httpStatus;
  host.storage.set("loginDiagnostic", info);
  console.log("[qishui] login:", JSON.stringify(info));
}

function loginPrompt(qr, text) {
  host.signInPrompt({ ...(qr ? { qr: qr.url } : {}), text: `[汽水 ${loginVersion}] ${text}` });
}

function passportURL(pathname) {
  const url = new URL(pathname, site);
  const params = {
    aid: "386088", passport_jssdk_version: "2.4.13", is_from_ttaccountsdk: "1",
    language: "zh", device_id: deviceId(), install_id: deviceId(),
    device_platform: "PC", version_code: "3520", next: site,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function loginRequest(jar, address, body, readJSON = true) {
  const url = loginURL(address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url.href, {
      method: body ? "POST" : "GET", redirect: "manual", signal: controller.signal,
      headers: {
        "User-Agent": UA, cookie: cookiesAsHeader(jar, url),
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    rememberCookies(jar, response, url);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      return { redirect: new URL(location, url).href };
    }
    if (!response.ok) {
      const error = fail("qishui-http", `汽水登录请求失败（HTTP ${response.status}）。`);
      error.httpStatus = response.status;
      throw error;
    }
    if (!readJSON) return {};
    let payload;
    try { payload = await response.json(); } catch {
      if (controller.signal.aborted) throw fail("qishui-network-timeout", "汽水登录请求超时，请重试。");
      throw fail("qishui-invalid-response", "汽水登录接口没有返回有效 JSON，已停止等待。");
    }
    const data = payload?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw fail("qishui-invalid-response", "汽水登录接口返回了无法识别的数据，已停止等待。");
    }
    const code = Number(data.error_code ?? payload.error_code ?? 0);
    if (!Number.isFinite(code) || code !== 0 || payload.message === "error") {
      const error = fail("qishui-api", code === 2046
        ? "汽水要求额外安全验证（2046）。当前插件尚未接入官方安全验证窗口，本次未完成登录。"
        : `汽水登录接口拒绝请求（错误码 ${Number.isFinite(code) ? code : "unknown"}），已停止等待。`);
      error.apiCode = code;
      throw error;
    }
    return { data };
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("qishui-")) throw error;
    throw fail(controller.signal.aborted ? "qishui-network-timeout" : "qishui-network",
      controller.signal.aborted ? "汽水登录请求超时，请重试。" : "无法连接汽水登录服务，请检查网络后重试。");
  } finally {
    clearTimeout(timer);
  }
}

function qrOf(data) {
  if (typeof data.token !== "string" || !data.token) {
    throw fail("qishui-invalid-response", "汽水没有返回二维码 token。");
  }
  const sourceToken = data.qrcode_index_url
    ? loginURL(data.qrcode_index_url).searchParams.get("token") : data.token;
  if (!sourceToken) throw fail("qishui-invalid-response", "汽水二维码链接缺少 token。");
  const url = new URL("https://bff-pc.qishui.com/light/invoke/scan_login");
  url.searchParams.set("token", sourceToken);
  url.searchParams.set("os", "Windows");
  url.searchParams.set("computer_name", "MyGo-Music");
  return { token: data.token, url: url.href };
}

async function getQrCode(jar) {
  const url = passportURL("/passport/web/get_qrcode/");
  url.searchParams.set("need_logo", "false");
  url.searchParams.set("need_short_url", "false");
  const { data } = await loginRequest(jar, url);
  if (!data) throw fail("qishui-invalid-response", "汽水没有返回二维码数据。");
  return qrOf(data);
}

async function followForCookies(jar, address) {
  let current = address;
  for (let hop = 0; hop < 5; hop++) {
    const { redirect } = await loginRequest(jar, current, undefined, false);
    if (!redirect) return;
    current = redirect;
  }
  throw fail("qishui-redirect", "汽水登录重定向次数过多，已停止等待。");
}

async function checkQr(jar, token) {
  const { data = {}, redirect } = await loginRequest(jar, passportURL("/passport/web/check_qrconnect/"), {
    token, need_logo: "false", need_short_url: "false", is_frontier: "true", is_new_login: "1", next: site,
  });
  const status = String(data.status ?? "");
  loginDiagnostic("poll", { status });
  if (status === "expired" || status === "4") return { expired: true, data };
  if (["cancelled", "canceled", "rejected", "5"].includes(status)) {
    throw fail("qishui-cancelled", "手机端已取消或拒绝登录，请重新发起登录。");
  }
  if (typeof data.session_cookie === "string") {
    for (const pair of data.session_cookie.split(";")) {
      // The body contains a Cookie header, not a Set-Cookie attribute list.
      rememberCookies(jar, { headers: { getSetCookie: () => [`${pair}; Domain=qishui.com; Path=/; Secure`] } }, new URL(site));
    }
  }
  const next = redirect || data.redirect_url;
  const confirmed = ["confirmed", "3"].includes(status) || Boolean(data.session_cookie) || Boolean(next);
  if (confirmed) loginPrompt(null, "手机已确认，正在完成登录…");
  // A redirect is an exchange step, not proof of success; it must issue a session.
  if (next && !hasSessionCookie(cookiesAsHeader(jar))) {
    if (typeof next !== "string") throw fail("qishui-invalid-response", "汽水登录跳转地址不是字符串。");
    await followForCookies(jar, loginURL(next).href);
  }
  const session = cookiesAsHeader(jar);
  if (hasSessionCookie(session)) return { session };
  if (confirmed) {
    throw fail("qishui-missing-session", "手机已确认，但汽水未向插件下发登录会话，不能判定为登录成功。请反馈此提示。");
  }
  if (!["new", "1", "scanned", "scaned", "2"].includes(status)) {
    throw fail("qishui-status", "汽水返回了无法识别的扫码状态，已停止等待。请反馈此提示。");
  }
  return { scanned: ["scanned", "scaned", "2"].includes(status) };
}

// ---------- 账号 ----------

const defaultAccount = () => ({ id: "qishui", name: "汽水音乐用户" });

export async function signIn() {
  if (signingIn) throw fail("qishui-busy", "登录正在进行，请先完成当前登录。");
  signingIn = true;
  const jar = new Map();
  const deadline = Date.now() + 180000;
  try {
    loginDiagnostic("starting");
    let qr = await getQrCode(jar);
    loginPrompt(qr, "请用抖音 App 扫码，并在手机上确认登录。");
    for (let poll = 0; poll < 90 && Date.now() < deadline; poll++) {
      await sleep(2000);
      if (Date.now() >= deadline) break;
      const result = await checkQr(jar, qr.token);
      if (result.expired) {
        qr = result.data.token ? qrOf(result.data) : await getQrCode(jar);
        loginPrompt(qr, "二维码已过期，请扫描新的二维码。");
      } else if (result.session) {
        const me = defaultAccount();
        host.storage.set("cookie", result.session);
        host.storage.set("account", me);
        loginDiagnostic("success");
        loginPrompt(null, "登录会话已保存，正在进入汽水音乐…");
        // MyGo closes its QR dialog only after this export resolves.
        // /me may require additional signing or hang; never wait for it here.
        return me;
      } else if (result.scanned) {
        loginPrompt(qr, "已扫码，请在手机上点击确认登录。");
      }
    }
    throw fail("qishui-timeout", "扫码登录超时，请重新发起登录。");
  } catch (error) {
    loginDiagnostic("failed", { reason: error?.code, errorCode: error?.apiCode, httpStatus: error?.httpStatus });
    throw error;
  } finally {
    signingIn = false;
    jar.clear();
  }
}

export function account() {
  if (!hasSessionCookie(cookie())) return null;
  return host.storage.get("account") || defaultAccount();
}

export function signOut() {
  host.storage.remove("cookie");
  host.storage.remove("account");
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
