const assert = require('node:assert/strict');
const test = require('node:test');
const { runLogin, accountResult, scanURL } = require('../helper/auth-flow.cjs');
const cookie = 'sessionid=test-session-secret';
const profile = { id: 'user-42', name: 'Test listener' };
const packet = data => ({ message: 'success', data: { error_code: 0, ...data } });
function adapter(sequence = []) {
  const events = []; const calls = []; let verified = false;
  return {
    events, calls, now: () => 0, sleep: async () => {},
    ready: async () => {}, restore: async () => null,
    createQR: async () => packet({ token: 'test-token', qrcode_index_url: 'https://bff-pc.qishui.com/sdk-next?token=test-token' }),
    poll: async (token, options) => { calls.push({ token, options }); return sequence.shift(); },
    verify: async () => { verified = true; return { status: true }; },
    importCookies: async () => {}, exchange: async () => {},
    finish: async () => ({ cookie, account: profile }),
    progress: event => events.push(event), platform: 'darwin', computerName: 'MyGo Music',
    get verified() { return verified; },
  };
}

test('the official flow only returns after account verification', async () => {
  const a = adapter([packet({ status: 'scanned' }), packet({ status: 'confirmed' })]);
  let finished = false; a.finish = async () => { finished = true; return { cookie, account: profile }; };
  const result = await runLogin(a);
  assert.equal(finished, true); assert.equal(result.account.id, profile.id);
  assert.ok(a.events.some(e => e.stage === 'scanned'));
  assert.ok(a.events.some(e => e.stage === 'verifying-account'));
});

for (const code of [7, 4031]) test(`API error ${code} cannot be overridden by a confirmed status or cookie`, async () => {
  const a = adapter([packet({ status: 'confirmed', error_code: code, session_cookie: cookie })]);
  await assert.rejects(runLogin(a), e => e.apiCode === code);
  assert.equal(a.calls.length, 1);
});

test('2046 opens the official verification step and resubmits server-provided parameters', async () => {
  const a = adapter([packet({ error_code: 2046, biz_params: '{"verify_ticket":"test-ticket"}' }), packet({ status: 'confirmed' })]);
  const result = await runLogin(a);
  assert.equal(a.verified, true); assert.equal(result.account.id, profile.id);
  assert.equal(a.calls[1].options.resend, true);
  assert.equal(a.calls[1].options.biz.verify_ticket, 'test-ticket');
});

test('cancelled verification is never a successful login', async () => {
  const a = adapter([packet({ error_code: 2046 })]); a.verify = async () => ({ status: false });
  await assert.rejects(runLogin(a), e => e.code === 'cancelled');
});

test('confirmed status without a session or verified account cannot report success', async () => {
  for (const result of [{ cookie: '', account: profile }, { cookie, account: { name: 'Generic account' } }, null]) {
    const a = adapter([packet({ status: 'confirmed' })]); a.finish = async () => result;
    await assert.rejects(runLogin(a));
  }
});

test('expiry rotates the displayed and polled QR token', async () => {
  const a = adapter([packet({ status: 'expired', token: 'next-token' }), packet({ status: 'confirmed' })]);
  await runLogin(a);
  assert.equal(a.calls[1].token, 'next-token');
  assert.ok(a.events.some(e => e.qr && new URL(e.qr).searchParams.get('token') === 'next-token'));
});

test('an existing private helper session is still account-verified before being reused', async () => {
  const a = adapter(); a.restore = async () => ({ cookie, account: profile });
  assert.equal((await runLogin(a)).account.id, profile.id);
  assert.equal(a.calls.length, 0);
  assert.throws(() => accountResult({ cookie: 'sessionid_extra=bad', account: profile }));
});

test('phone cancellation, unknown state and aborted operation terminate', async () => {
  for (const status of ['rejected', 'unrecognized']) await assert.rejects(runLogin(adapter([packet({ status })])));
  const a = adapter(); a.signal = AbortSignal.abort();
  await assert.rejects(runLogin(a), e => e.code === 'cancelled');
});

// Real SDK login issued a session before Chromium rejected the final response.
// Only an independent authenticated profile request may recover this transport error.
test('a network error after session issuance completes only after independent account verification', async () => {
  const a = adapter(); let validated = false;
  a.poll = async () => { const e = new Error('transport failed'); e.code = 'network'; throw e; };
  a.finish = async () => { validated = true; return { cookie, account: profile }; };
  const result = await runLogin(a);
  assert.equal(validated, true); assert.equal(result.account.id, profile.id);
  assert.ok(a.events.some(e => e.stage === 'verifying-account'));
});

test('a network error without a verified new session remains a failure', async () => {
  const a = adapter();
  a.poll = async () => { const e = new Error('transport failed'); e.code = 'network'; throw e; };
  a.finish = async () => { throw new Error('no authenticated account'); };
  await assert.rejects(runLogin(a), error => error.code === 'network');
});

test('an explicit API rejection cannot be recovered with a stale cookie', async () => {
  const a = adapter(); let attempted = false;
  a.poll = async () => { const e = new Error('rejected'); e.code = 'api'; e.apiCode = 7; throw e; };
  a.finish = async () => { attempted = true; return { cookie, account: profile }; };
  await assert.rejects(runLogin(a), error => error.apiCode === 7);
  assert.equal(attempted, false);
});

test('QR codes use the actual Mac label and cannot point at an unrelated service', () => {
  const url = new URL(scanURL({ token: 'test-token' }, 'darwin', 'MyGo Music'));
  assert.equal(url.searchParams.get('os'), 'Mac');
  assert.throws(() => scanURL({ token: 'test-token', qrcode_index_url: 'https://evil.test/?token=secret' }, 'darwin', 'Test'));
});
