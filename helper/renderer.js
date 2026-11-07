'use strict';
// This renderer has no Node access. Only fixed operations are invoked by the main process.
(() => {
  window.ucSecondVerifyReact = window.React;
  window.ucSecondVerifyReactDom = window.ReactDOM;
  const requests = new Set();
  let finishVerification = null;
  function status(text) { document.getElementById('status').textContent = text; }
  function cancel() {
    if (finishVerification) finishVerification({ status: false });
    for (const request of requests) request.abort();
    status('已取消。可以关闭此窗口。');
  }
  document.getElementById('cancel').addEventListener('click', () => { cancel(); window.close(); });
  function request(input) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); requests.add(xhr);
      xhr.open(input.method || 'GET', input.url, true);
      xhr.withCredentials = true; xhr.timeout = 20000;
      for (const [name, value] of Object.entries(input.headers || {})) xhr.setRequestHeader(name, String(value));
      const done = fn => { requests.delete(xhr); fn(); };
      xhr.onload = () => done(() => resolve({ status: xhr.status, body: xhr.responseText }));
      xhr.onerror = () => done(() => reject(new Error('request-failed')));
      xhr.ontimeout = () => done(() => reject(new Error('request-timeout')));
      xhr.onabort = () => done(() => reject(new Error('request-cancelled')));
      xhr.send(input.body ?? null);
    });
  }
  async function browserInfo() {
    let estimate = {}, permission = 'unsupported', localSize = 0, webgl = {};
    try { estimate = await navigator.storage.estimate(); } catch {}
    try { permission = (await navigator.permissions.query({ name: 'notifications' })).state; } catch {}
    try { for (const key of Object.keys(localStorage)) localSize += (localStorage.getItem(key) || '').length; } catch {}
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      if (extension) webgl = { vendor: gl.getParameter(extension.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) };
    } catch {}
    const navigation = performance.getEntriesByType('navigation')[0];
    const info = {
      hardwareConcurrency: navigator.hardwareConcurrency,
      webdriver: Boolean(navigator.webdriver), chromedriver: false, shelldriver: false,
      plugins: navigator.plugins?.length || 0,
      permissions: [{ name: 'notifications', state: permission }],
      innerHeight, innerWidth, outerHeight, outerWidth,
      stoargeStatus: {
        indexedDB: { idb: typeof indexedDB, open: typeof indexedDB?.open, indexedDB: typeof indexedDB, IDBKeyRange: typeof IDBKeyRange, openDatabase: typeof window.openDatabase, isSafari: false, hasFetch: typeof fetch === 'function' && fetch.toString().includes('[native code') },
        localStorage: { isSupportLStorage: true, size: localSize, write: true },
        storageQuotaStatus: { usage: estimate.usage, quota: estimate.quota, isPrivate: Boolean(estimate.quota && estimate.quota < 120000000) },
      },
      webgl, notificationPermission: window.Notification?.permission || 'unsupported',
      performance: {
        timeOrigin: performance.timeOrigin, usedJSHeapSize: performance.memory?.usedJSHeapSize ?? 'unsupport',
        navigationTiming: { decodedBodySize: navigation?.decodedBodySize, entryType: navigation?.entryType, initiatorType: navigation?.initiatorType, name: navigation?.name, renderBlockingStatus: navigation?.renderBlockingStatus, serverTiming: (navigation?.serverTiming || []).map(v => v.name).join(',') },
      },
      request_host: location.host, request_pathname: location.pathname,
      browser: { t: String(Date.now()).split('').reverse().join(''), bit_protocol: 'false', bit_helper: false },
    };
    // Passport's browser-info field is XOR-5 hex encoding, not a request signature.
    return [...new TextEncoder().encode(JSON.stringify(info))].map(v => (v ^ 5).toString(16).padStart(2, '0')).join('');
  }
  function trustedVerifyURL(value) {
    const url = new URL(value);
    const roots = ['qishui.com', 'zijieapi.com', 'yhgfb-cn-static.com', 'bytetos.com', 'bytescm.com', 'bytegoofy.com', 'bytedance.com'];
    if (url.protocol !== 'https:' || url.username || url.password || !roots.some(root => url.hostname === root || url.hostname.endsWith('.' + root))) throw new Error('unsupported-verification-resource');
    return url;
  }
  async function verify(decision, generalParams) {
    if (!decision.url) throw new Error('missing-verification-resource');
    const url = trustedVerifyURL(decision.url);
    let eventParams = decision.event_params || {};
    if (typeof eventParams === 'string') eventParams = JSON.parse(eventParams);
    url.searchParams.set('aid', '386088');
    url.searchParams.set('verify_reason', String(eventParams.verify_reason || ''));
    url.searchParams.set('verify_scene', String(eventParams.verify_scene || ''));
    window.$$account_verify_portrait_id = decision.verify_portrait_id || '';
    if (typeof window.ucWebSecondVerify !== 'function') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = url.href; script.crossOrigin = 'anonymous';
        const timer = setTimeout(() => { script.remove(); reject(new Error('verification-load-timeout')); }, 20000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); reject(new Error('verification-load-failed')); };
        document.head.appendChild(script);
      });
    }
    if (typeof window.ucWebSecondVerify !== 'function') throw new Error('verification-entry-missing');
    document.getElementById('qr').style.display = 'none'; status('请完成汽水官方安全验证。');
    return new Promise(resolve => {
      let finished = false;
      const complete = value => {
        if (finished) return; finished = true; finishVerification = null;
        resolve({ status: value?.status === true });
      };
      finishVerification = complete;
      window.ucWebSecondVerify({
        ...decision, aid: 386088, isNewVerifyUI: true, generalParams, event_params: eventParams,
        verifyFinishCallback: complete,
        newSecondVerifyWebOptions: { host: 'https://api.qishui.com', verifyAppName: '汽水音乐移动端' },
        newSecondVerificationCall: { reportAppLog() {} },
        monitorTime: { startTime: Date.now(), fetchEndTime: Date.now(), scriptLoadStartTime: 0, scriptLoadEndTime: Date.now(), renderStartTime: Date.now() },
        fun: decision.verify_from === 'verify_center' ? 'verify_center' : 'verify', uc_account_verify_version: '1.0.29',
      });
    });
  }
  window.qishui = Object.freeze({
    request, browserInfo, verify, cancel,
    seed(token) { localStorage.setItem('xmst', token); localStorage.setItem('xmsty', token); },
    storedToken() { return localStorage.getItem('xmsty') || localStorage.getItem('xmst') || ''; },
    show(text, image) {
      status(text); const element = document.getElementById('qr');
      if (image) { element.src = image; element.style.display = 'block'; }
    },
  });
  window._SdkGlueInit({ self: { aid: 386088, pageId: 24554 }, bdms: { aid: 386088, paths: ['/passport', '/luna'] } });
})();
