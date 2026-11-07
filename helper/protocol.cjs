'use strict';
const MAX_LINE_BYTES = 65536;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const OPS = new Set(['hello', 'signIn', 'account', 'signOut', 'request', 'probe', 'shutdown']);
const MESSAGES = Object.freeze({
  setup: '汽水 SDK 运行时未就绪。请在插件目录运行 node helper/install.cjs；依赖将安装到独立数据目录。不要在插件目录执行 npm install/ci。',
  protocol: '汽水辅助程序协议数据无效。',
  busy: '已有汽水登录正在进行，请先完成或取消当前登录。',
  network: '无法连接汽水认证服务，请检查网络。',
  timeout: '汽水认证操作超时。',
  cancelled: '汽水登录或安全验证已取消。',
  sdk: '官方安全 SDK 未就绪或没有生成安全参数，已停止登录。',
  integrity: '官方 SDK 文件摘要校验失败，未执行该文件。',
  response: '汽水返回了无法识别的认证响应。',
  session: '汽水尚未向本插件下发有效登录会话。',
  account: '取得会话后仍无法验证汽水账号，本次未判定为登录成功。',
  api: '汽水接口拒绝请求。',
  verification: '汽水要求的官方安全验证未完成。',
  unavailable: '当前环境无法运行汽水官方 SDK。',
});
function fault(code, details = {}) {
  const error = new Error(MESSAGES[code] || MESSAGES.unavailable);
  error.code = code;
  for (const key of ['apiCode', 'httpStatus']) if (Number.isInteger(details[key])) error[key] = details[key];
  return error;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parseRequest(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > MAX_LINE_BYTES) throw fault('protocol');
  let value;
  try { value = JSON.parse(line); } catch { throw fault('protocol'); }
  if (!object(value) || !Number.isSafeInteger(value.id) || value.id < 1 || !OPS.has(value.op) ||
      (value.params !== undefined && !object(value.params))) throw fault('protocol');
  return { id: value.id, op: value.op, params: value.params || {} };
}
function apiURL(path, params = {}) {
  if (typeof path !== 'string' || path.length > 256 || !/^\/luna\/pc\/[a-zA-Z0-9_/-]+$/.test(path) ||
      path.split('/').some(p => p === '.' || p === '..') || !object(params)) throw fault('protocol');
  const url = new URL(path, 'https://api.qishui.com');
  for (const [key, value] of Object.entries(params)) {
    if (!/^[a-zA-Z0-9_]+$/.test(key) || /cookie|authorization|signature|token|host|user_agent|a_bogus/i.test(key) ||
        !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 4096) throw fault('protocol');
    url.searchParams.set(key, String(value));
  }
  return url;
}
function publicError(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : 'unavailable';
  const out = { code, message: MESSAGES[code] };
  if (Number.isInteger(error?.apiCode)) { out.apiCode = error.apiCode; out.message += `（错误码 ${error.apiCode}）`; }
  if (Number.isInteger(error?.httpStatus)) { out.httpStatus = error.httpStatus; out.message += `（HTTP ${error.httpStatus}）`; }
  return out;
}
function encodeResponse(value) {
  if (!object(value) || !Number.isSafeInteger(value.id) || value.id < 1 ||
      (value.event ? value.ok !== undefined || value.event !== 'prompt' : typeof value.ok !== 'boolean')) throw fault('protocol');
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) throw fault('response');
  return line + '\n';
}
module.exports = { MAX_LINE_BYTES, MAX_RESPONSE_BYTES, MESSAGES, fault, parseRequest, apiURL, publicError, encodeResponse };
