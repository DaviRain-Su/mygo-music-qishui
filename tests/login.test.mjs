import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
const token = "test-qr-token_lq";
const csrf = "test-csrf-secret";
const session = "test-session-secret";
const json = (data, headers) => new Response(JSON.stringify(data), { headers });
const qrResponse = () => json({
  message: "success",
  data: {
    error_code: 0,
    token,
    qrcode_index_url: `https://bff-pc.qishui.com/ucenter_web/app/sdk-next?token=${token}`,
  },
}, { "set-cookie": `passport_csrf_token=${csrf}; Domain=qishui.com; Path=/; Secure` });
const pollResponse = (data, headers) => json({ message: "success", data: { error_code: 0, ...data } }, headers);

// Execute the entire shipped module, not a copied/extracted checkQr function.
// No host.t is supplied: this is also the MyGo 0.1.7 compatibility path.
async function loadPlugin(handler, { getSetCookie = true, qr = qrResponse } = {}) {
  const storage = new Map();
  const requests = [];
  const prompts = [];
  const logs = [];
  let clock = 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, Date: Clock,
    setTimeout(fn, ms) {
      // Skip the human wait, but keep request deadlines working for stalled fetches.
      if (ms <= 2000) {
        clock += ms;
        queueMicrotask(fn);
        return null;
      }
      return setTimeout(fn, 30);
    },
    clearTimeout,
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    host: {
      platform: "darwin",
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
        remove: (key) => storage.delete(key),
      },
      signInPrompt: (prompt) => prompts.push(prompt),
    },
    fetch: async (input, options = {}) => {
      const request = { url: new URL(String(input)), ...options };
      requests.push(request);
      let response;
      if (request.url.pathname === "/passport/web/get_qrcode/") {
        response = qr();
      } else {
        response = await handler(request, requests);
      }
      if (!getSetCookie) {
        // Older Headers implementations only expose a combined Set-Cookie header.
        const responseHeaders = response.headers;
        response = {
          status: response.status, ok: response.ok,
          headers: { get: (name) => responseHeaders.get(name) },
          json: response.json.bind(response), text: response.text.bind(response),
        };
      }
      return response;
    },
  });
  const module = new vm.SourceTextModule(source, { context, identifier: "qishui/index.js" });
  await module.link(() => { throw new Error("The plugin must remain a self-contained module"); });
  await module.evaluate();
  return { plugin: module.namespace, storage, requests, prompts, logs };
}

// The old Map/Object.entries mix-up silently sent an empty Cookie header.
test("poll sends the QR request's CSRF cookie and the same device parameters", async () => {
  let observed;
  const { plugin } = await loadPlugin((request) => {
    if (request.url.pathname === "/luna/pc/me") return json({ data: {} });
    observed = request;
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  });
  await plugin.signIn();
  assert.equal(new Headers(observed.headers).get("cookie"), `passport_csrf_token=${csrf}`);
  assert.equal(new Headers(observed.headers).get("x-tt-passport-csrf-token"), csrf);
  assert.equal(observed.url.searchParams.get("passport_jssdk_version"), "2.4.13");
  assert.equal(observed.url.searchParams.get("is_from_ttaccountsdk"), "1");
  assert.ok(observed.url.searchParams.get("device_id"));
});

// MyGo closes the dialog only when signIn resolves. A hung /me must not block it.
test("a confirmed session returns an account without waiting on /me", { timeout: 1000 }, async () => {
  const { plugin, storage, requests } = await loadPlugin((request) => {
    if (request.url.pathname === "/luna/pc/me") throw new Error("Profile endpoint is unavailable");
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  });
  const account = await plugin.signIn();
  assert.ok(account.id && account.name);
  assert.match(storage.get("cookie"), new RegExp(`sessionid=${session}`));
  assert.equal(requests.some((r) => r.url.pathname === "/luna/pc/me"), false);
  assert.equal((await plugin.account()).id, account.id);
});

// Both confirmed status spellings must settle the exported signIn promise.
for (const status of ["confirmed", "3", 3]) {
  test(`confirmed status ${JSON.stringify(status)} with Set-Cookie resolves`, async () => {
    const { plugin, storage } = await loadPlugin((request) => {
      if (request.url.pathname === "/luna/pc/me") return json({ data: {} });
      return pollResponse({ status }, { "set-cookie": `sessionid=${session}; Domain=qishui.com; Path=/; Secure` });
    });
    assert.ok((await plugin.signIn()).id);
    assert.match(storage.get("cookie"), new RegExp(`sessionid=${session}`));
  });
}

// API errors used to look like "still waiting", even after a successful phone scan.
for (const errorCode of [7, 2046, 4031]) {
  test(`API error ${errorCode} stops polling and stays visible`, async () => {
    let polls = 0;
    const { plugin, storage } = await loadPlugin(() => {
      polls++;
      return json({ message: "error", data: { error_code: errorCode, status: "confirmed" } });
    });
    await assert.rejects(plugin.signIn(), (error) => error.message.includes(String(errorCode)));
    assert.equal(polls, 1);
    assert.equal(storage.has("cookie"), false);
  });
}

// A status alone is not a session; repeatedly polling a consumed token cannot fix it.
test("confirmed without a session fails explicitly instead of looping", async () => {
  let polls = 0;
  const { plugin, storage } = await loadPlugin(() => {
    polls++;
    return pollResponse({ status: "confirmed" });
  });
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-missing-session");
  assert.equal(polls, 1);
  assert.equal(storage.has("cookie"), false);
});

// Login cookies can be issued on intermediate redirect responses.
test("redirect exchange carries cookies and captures intermediate Set-Cookie", async () => {
  const { plugin, storage } = await loadPlugin((request) => {
    if (request.url.pathname === "/passport/web/check_qrconnect/") {
      return pollResponse({ status: "confirmed", redirect_url: "https://api.qishui.com/passport/finish" });
    }
    if (request.url.pathname === "/passport/finish") {
      assert.equal(new Headers(request.headers).get("cookie"), `passport_csrf_token=${csrf}`);
      return new Response(null, {
        status: 302,
        headers: { location: "/passport/done", "set-cookie": `sessionid=${session}; Domain=qishui.com; Path=/; Secure` },
      });
    }
    if (request.url.pathname === "/passport/done") {
      assert.match(new Headers(request.headers).get("cookie"), new RegExp(`sessionid=${session}`));
      return new Response("done");
    }
    if (request.url.pathname === "/luna/pc/me") return json({ data: {} });
    throw new Error(`Unexpected request: ${request.url.pathname}`);
  });
  assert.ok((await plugin.signIn()).id);
  assert.match(storage.get("cookie"), new RegExp(`sessionid=${session}`));
});

// A broken server response must not silently turn into another three-minute wait.
test("malformed poll JSON reports an error rather than being swallowed", async () => {
  let polls = 0;
  const { plugin } = await loadPlugin(() => { polls++; return new Response("not JSON"); });
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-invalid-response");
  assert.equal(polls, 1);
});

// Login diagnostics must not contain tokens, Cookie headers, or session values.
test("diagnostics are redacted and record the terminal failure", async () => {
  const { plugin, storage, logs } = await loadPlugin(() => json({
    message: "error", data: { error_code: 2046, token, session_cookie: `sessionid=${session}` },
  }));
  await assert.rejects(plugin.signIn());
  const diagnostic = storage.get("loginDiagnostic");
  assert.equal(diagnostic.errorCode, 2046);
  const output = JSON.stringify([diagnostic, logs]);
  for (const secret of [token, csrf, session]) assert.equal(output.includes(secret), false);
});

// Even a malformed status field must not turn into a secret-bearing log message.
test("unknown status is redacted", async () => {
  const { plugin, storage, logs } = await loadPlugin(() => pollResponse({ status: token }));
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-status");
  const diagnostic = storage.get("loginDiagnostic");
  assert.equal(diagnostic.status, "unknown");
  assert.equal(JSON.stringify([diagnostic, logs]).includes(token), false);
});

// The official Passport SDK mirrors this cookie into x-tt-passport-csrf-token.
test("CSRF header uses the default token when the primary token is absent", async () => {
  const { plugin } = await loadPlugin((request) => {
    assert.equal(new Headers(request.headers).get("x-tt-passport-csrf-token"), csrf);
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  }, { qr: () => json({ data: { error_code: 0, token } }, {
    "set-cookie": `passport_csrf_token_default=${csrf}; Domain=qishui.com; Path=/; Secure`,
  }) });
  assert.ok((await plugin.signIn()).id);
});

test("does not send an empty CSRF header when no CSRF cookie was issued", async () => {
  const { plugin } = await loadPlugin((request) => {
    assert.equal(new Headers(request.headers).get("x-tt-passport-csrf-token"), null);
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  }, { qr: () => json({ data: { error_code: 0, token } }) });
  assert.ok((await plugin.signIn()).id);
});

// A token rotated during scanning must replace the header for the next POST.
test("CSRF header follows cookie rotation after scanned status", async () => {
  let polls = 0;
  const { plugin } = await loadPlugin((request) => {
    const expected = polls++ === 0 ? csrf : "rotated-csrf";
    assert.equal(new Headers(request.headers).get("x-tt-passport-csrf-token"), expected);
    if (polls === 1) return pollResponse({ status: "scanned" }, {
      "set-cookie": "passport_csrf_token=rotated-csrf; Domain=qishui.com; Path=/; Secure",
    });
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  });
  assert.ok((await plugin.signIn()).id);
  assert.equal(polls, 2);
});

// Do not infer the meaning of code 7 from its number; use only explicit server wording.
test("code 7 can report a redacted CSRF classification without logging its description", async () => {
  const { plugin, storage, logs } = await loadPlugin(() => json({
    message: "error", data: { error_code: 7, description: `CSRF token mismatch: ${csrf}; sessionid=${session}`, token },
  }));
  await assert.rejects(plugin.signIn(), (error) => error.message.includes("7") && error.message.includes("CSRF"));
  const diagnostic = storage.get("loginDiagnostic");
  assert.equal(diagnostic.serverReason, "csrf");
  assert.equal(diagnostic.errorCode, 7);
  const output = JSON.stringify([diagnostic, logs]);
  for (const secret of [token, csrf, session]) assert.equal(output.includes(secret), false);
  assert.equal(output.includes("mismatch"), false);
});

test("code 7 without an explanation is not mislabeled as CSRF", async () => {
  const { plugin, storage } = await loadPlugin(() => json({ message: "error", data: { error_code: 7 } }));
  await assert.rejects(plugin.signIn(), (error) => error.message.includes("7") && !error.message.includes("CSRF"));
  assert.equal(storage.get("loginDiagnostic").serverReason, "unknown");
});

// The dialog should tell apart scanning and actually confirming on the phone.
test("new -> scanned -> confirmed updates progress and completes", async () => {
  const states = ["new", "scanned", "confirmed"];
  const { plugin, prompts } = await loadPlugin(() => {
    const status = states.shift();
    return pollResponse({ status, ...(status === "confirmed" ? { session_cookie: `sessionid=${session}` } : {}) });
  });
  assert.ok((await plugin.signIn()).id);
  assert.equal(states.length, 0);
  assert.ok(prompts.some((p) => p.text.includes("已扫码")));
  assert.ok(prompts.at(-1).text.includes("会话已保存"));
});

// A refreshed code must be displayed and polled, not just acknowledged.
test("expired QR is replaced with the new token", async () => {
  let polls = 0;
  const { plugin, prompts } = await loadPlugin((request) => {
    const body = new URLSearchParams(request.body);
    if (polls++ === 0) return pollResponse({
      status: "expired", token: "next-token", qrcode_index_url: "https://bff-pc.qishui.com/ucenter_web/app/sdk-next?token=next-token",
    });
    assert.equal(body.get("token"), "next-token");
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  });
  assert.ok((await plugin.signIn()).id);
  assert.ok(prompts.some((p) => p.qr && new URL(p.qr).searchParams.get("token") === "next-token"));
});

// Headers without getSetCookie must still preserve commas in Expires and '=' in values.
test("combined Set-Cookie fallback retains complete session values", async () => {
  const { plugin, storage } = await loadPlugin(() => pollResponse({ status: "confirmed" }, [
    ["set-cookie", "other=value; Expires=Wed, 01 Jan 2036 00:00:00 GMT; Domain=qishui.com; Path=/"],
    ["set-cookie", `sessionid=${session}==; Domain=qishui.com; Path=/; Max-Age=3600`],
  ]), { getSetCookie: false });
  await plugin.signIn();
  assert.match(storage.get("cookie"), new RegExp(`sessionid=${session}==`));
});

// Never send CSRF/session credentials to an untrusted redirect or an insecure endpoint.
for (const target of ["https://qishui.com.evil.example/exchange", "http://api.qishui.com/exchange"]) {
  test(`rejects untrusted redirect ${target}`, async () => {
    let calls = 0;
    const { plugin, storage } = await loadPlugin(() => {
      calls++;
      return pollResponse({ status: "confirmed", redirect_url: target });
    });
    await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-redirect");
    assert.equal(calls, 1);
    assert.equal(storage.has("cookie"), false);
  });
}

// Host-only cookies must not leak to another permitted qishui.com host.
test("redirects respect cookie host scope", async () => {
  const { plugin } = await loadPlugin((request) => {
    if (request.url.pathname === "/passport/web/check_qrconnect/") {
      assert.equal(new Headers(request.headers).get("cookie"), `passport_csrf_token=${csrf}`);
      return pollResponse({ status: "confirmed", redirect_url: "https://bff-pc.qishui.com/exchange" });
    }
    assert.equal(new Headers(request.headers).get("cookie"), "");
    assert.equal(new Headers(request.headers).get("x-tt-passport-csrf-token"), null);
    return new Response("ok", { headers: { "set-cookie": `sessionid=${session}; Domain=qishui.com; Path=/; Secure` } });
  }, { qr: () => json({ data: { error_code: 0, token } }, {
    "set-cookie": `passport_csrf_token=${csrf}; Path=/; Secure`,
  }) });
  assert.ok((await plugin.signIn()).id);
});

// Deletion cookies or similarly named cookies must not be mistaken for authentication.
for (const cookieValue of ["sessionid=; Max-Age=0", "sessionid=old; Max-Age=0", "sessionid_extra=not-a-session"]) {
  test(`does not authenticate with ${cookieValue}`, async () => {
    const { plugin, storage } = await loadPlugin(() => pollResponse({ status: "confirmed" }, {
      "set-cookie": `${cookieValue}; Domain=qishui.com; Path=/`,
    }));
    await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-missing-session");
    assert.equal(storage.has("cookie"), false);
    assert.equal(storage.get("loginDiagnostic").reason, "qishui-missing-session");
  });
}

// A session scoped only to /passport cannot authenticate catalog requests at /luna.
test("path-scoped session cookie is not saved as a catalog session", async () => {
  const { plugin } = await loadPlugin(() => pollResponse({ status: "confirmed" }, {
    "set-cookie": `sessionid=${session}; Domain=qishui.com; Path=/passport`,
  }));
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-missing-session");
});

// Reject/cancel and HTTP errors are terminal, not another silent poll.
test("cancelled on the phone stops polling", async () => {
  let polls = 0;
  const { plugin } = await loadPlugin(() => { polls++; return pollResponse({ status: "rejected" }); });
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-cancelled");
  assert.equal(polls, 1);
});

test("HTTP failure is reported with its status", async () => {
  const { plugin, storage } = await loadPlugin(() => new Response("error", { status: 503 }));
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-http");
  assert.equal(storage.get("loginDiagnostic").httpStatus, 503);
});

// A fetch that never answers must abort, including a DOMException with numeric code 20.
test("stalled poll times out instead of holding the MyGo dialog forever", { timeout: 1000 }, async () => {
  const { plugin } = await loadPlugin((request) => new Promise((resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
  }));
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-network-timeout");
});

// Malfunctioning redirects must not spin forever, even without any credentials.
test("redirect chain has a fixed hop limit", async () => {
  let redirects = 0;
  const { plugin } = await loadPlugin((request) => {
    if (request.url.pathname === "/passport/web/check_qrconnect/") {
      return pollResponse({ status: "confirmed", redirect_url: "https://api.qishui.com/loop" });
    }
    redirects++;
    return new Response(null, { status: 302, headers: { location: "/loop" } });
  });
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-redirect");
  assert.equal(redirects, 5);
});

// Repeated attempts must use separate jars, not stale cookies from the previous attempt.
test("a failed attempt can be retried without stale cookies", async () => {
  let attempt = 0;
  const { plugin } = await loadPlugin((request) => {
    if (attempt === 1) return json({ message: "error", data: { error_code: 2046 } });
    assert.equal(new Headers(request.headers).get("cookie"), "passport_csrf_token=second-csrf");
    return pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` });
  }, { qr: () => {
    attempt++;
    return json({ data: { error_code: 0, token } }, { "set-cookie": `passport_csrf_token=${attempt === 1 ? csrf : "second-csrf"}; Domain=qishui.com; Path=/; Secure` });
  } });
  await assert.rejects(plugin.signIn());
  assert.ok((await plugin.signIn()).id);
});

// Concurrent exports must not overwrite another pending QR login's cookies or result.
test("a second signIn cannot interfere with the first", async () => {
  const { plugin } = await loadPlugin(() => pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` }));
  const first = plugin.signIn();
  await assert.rejects(plugin.signIn(), (error) => error.code === "qishui-busy");
  assert.ok((await first).id);
});

// Ending the session must remove the cached account as well, without fetching /me.
test("signOut clears session and account", async () => {
  const { plugin, storage } = await loadPlugin(() => pollResponse({ status: "confirmed", session_cookie: `sessionid=${session}` }));
  await plugin.signIn();
  plugin.signOut();
  assert.equal(await plugin.account(), null);
  assert.equal(storage.has("cookie"), false);
  assert.equal(storage.has("account"), false);
});
