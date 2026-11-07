'use strict';
const { fault } = require('./protocol.cjs');
const SESSION_NAMES = new Set(['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt']);
function hasSession(cookie) {
  return typeof cookie === 'string' && cookie.split(';').some(pair => {
    const at = pair.indexOf('=');
    return at > 0 && SESSION_NAMES.has(pair.slice(0, at).trim()) &&
      !['', 'null', 'undefined', 'deleted'].includes(pair.slice(at + 1).trim().toLowerCase());
  });
}
function accountResult(result) {
  if (!hasSession(result?.cookie)) throw fault('session');
  const account = result.account;
  if (!account || typeof account.id !== 'string' || !account.id || typeof account.name !== 'string' || !account.name) throw fault('account');
  return { cookie: result.cookie, account: { id: account.id, name: account.name, ...(account.imageUrl ? { imageUrl: account.imageUrl } : {}) } };
}
function scanURL(data, platform, computerName) {
  if (typeof data?.token !== 'string' || !data.token || data.token.length > 4096) throw fault('response');
  let token = data.token;
  if (data.qrcode_index_url) {
    const source = new URL(data.qrcode_index_url);
    if (source.origin !== 'https://bff-pc.qishui.com') throw fault('response');
    token = source.searchParams.get('token'); if (!token) throw fault('response');
  }
  const url = new URL('https://bff-pc.qishui.com/light/invoke/scan_login');
  url.searchParams.set('token', token);
  url.searchParams.set('os', platform === 'darwin' ? 'Mac' : 'Windows');
  url.searchParams.set('computer_name', computerName || 'MyGo Music');
  return url.href;
}
function dataOf(packet) {
  if (!packet || !packet.data || typeof packet.data !== 'object' || Array.isArray(packet.data)) throw fault('response');
  return packet.data;
}
function checkError(data) {
  const code = Number(data.error_code ?? 0);
  if (!Number.isFinite(code)) throw fault('response');
  if (code !== 0) throw fault('api', { apiCode: code });
}
function businessParams(raw) {
  if (!raw) return {};
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { data = Object.fromEntries(new URLSearchParams(raw)); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fault('response');
  const out = Object.create(null);
  for (const [key, value] of Object.entries(data)) {
    if (['__proto__', 'constructor', 'prototype', 'token', 'next'].includes(key)) continue;
    if (value === undefined) continue;
    if (key.length > 128 || JSON.stringify(value).length > 16384) throw fault('response');
    out[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return out;
}
async function runLogin(a) {
  const now = a.now || Date.now;
  const deadline = now() + 240000;
  const cancelled = () => {
    if (a.signal?.aborted) throw fault('cancelled');
    if (now() >= deadline) throw fault('timeout');
  };
  cancelled(); a.progress({ stage: 'starting', text: '正在初始化官方安全 SDK…' });
  await a.ready(); cancelled();
  const restored = await a.restore(); cancelled();
  if (restored) {
    const result = accountResult(restored);
    a.progress({ stage: 'authenticated', text: '已重新验证本插件保存的登录会话，正在进入汽水音乐…' });
    return result;
  }
  let qr = dataOf(await a.createQR()); checkError(qr);
  a.progress({ stage: 'waiting-scan', qr: scanURL(qr, a.platform, a.computerName), text: '请用抖音 App 扫码，并在手机上确认。' });
  for (let polls = 0; polls < 120; polls++) {
    cancelled(); await a.sleep(2000); cancelled();
    let data;
    try { data = dataOf(await a.poll(qr.token, {})); }
    catch (error) {
      cancelled();
      if (error.code !== 'network') throw error;
      // Chromium may reject the final response after the service has set its cookies.
      // A separately authenticated user-info request, not the cookie alone, proves completion.
      a.progress({ stage: 'verifying-account', text: '确认响应传输中断，正在独立验证登录会话…' });
      let recovered;
      try { recovered = accountResult(await a.finish()); } catch { throw error; }
      cancelled();
      a.progress({ stage: 'authenticated', text: '登录会话和账号已验证，正在进入汽水音乐…' });
      return recovered;
    }
    if (Number(data.error_code) === 2046) {
      a.progress({ stage: 'verification', text: '请在弹出的官方安全验证窗口中完成验证。' });
      const result = await a.verify(data); cancelled();
      if (result?.status !== true) throw fault('cancelled');
      data = dataOf(await a.poll(qr.token, { resend: true, biz: businessParams(data.biz_params) }));
    }
    checkError(data); cancelled();
    const status = String(data.status ?? '');
    if (['expired', '4'].includes(status)) {
      qr = data.token ? data : dataOf(await a.createQR()); checkError(qr);
      a.progress({ stage: 'waiting-scan', qr: scanURL(qr, a.platform, a.computerName), text: '二维码已更新，请扫描新的二维码。' });
      continue;
    }
    if (['rejected', 'cancelled', 'canceled', '5'].includes(status)) throw fault('cancelled');
    if (['confirmed', '3'].includes(status) || data.session_cookie || data.redirect_url) {
      if (data.session_cookie) await a.importCookies(data.session_cookie);
      if (data.redirect_url) await a.exchange(data.redirect_url);
      a.progress({ stage: 'verifying-account', text: '手机已确认，正在验证登录会话和用户资料…' });
      const result = accountResult(await a.finish()); cancelled();
      a.progress({ stage: 'authenticated', text: '账号已验证，正在进入汽水音乐…' });
      return result;
    }
    if (['scanned', 'scaned', '2'].includes(status)) a.progress({ stage: 'scanned', text: '已扫码，请在手机上确认登录。' });
    else if (!['new', '1'].includes(status)) throw fault('response');
  }
  throw fault('timeout');
}
module.exports = { runLogin, accountResult, scanURL, hasSession, businessParams };
