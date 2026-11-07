const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRequest, apiURL, publicError, MAX_LINE_BYTES, encodeResponse } = require('../helper/protocol.cjs');

test('only a bounded JSON object with an integer id and known operation is accepted', () => {
  assert.deepEqual(parseRequest('{"id":1,"op":"hello"}'), { id: 1, op: 'hello', params: {} });
  for (const raw of ['null', '[]', '{}', '{"id":0,"op":"hello"}', '{"id":1,"op":"eval"}', '{"id":1,"op":"signIn","params":[]}']) {
    assert.throws(() => parseRequest(raw));
  }
  assert.throws(() => parseRequest(' '.repeat(MAX_LINE_BYTES + 1)));
});

test('API requests cannot escape the fixed service and catalog path', () => {
  assert.equal(apiURL('/luna/pc/me', { count: 20 }).origin, 'https://api.qishui.com');
  for (const path of ['https://evil.test/luna/pc/me', '//evil.test/luna/pc/me', '/luna/pc/../../passport/web/logout/', '/luna/pc/%2e%2e/%2e%2e/passport', '/luna/pc/me?url=secret', '/luna/pc/me#secret']) {
    assert.throws(() => apiURL(path, {}));
  }
  assert.throws(() => apiURL('/luna/pc/me', { cookie: 'secret' }));
});

test('errors crossing the protocol are fixed public messages, not raw upstream responses', () => {
  const error = new Error('Cookie=sessionid=very-secret; token=secret-token');
  const safe = publicError(error);
  assert.equal(JSON.stringify(safe).includes('very-secret'), false);
  assert.equal(JSON.stringify(safe).includes('secret-token'), false);
});

test('protocol responses distinguish a terminal result from a progress event', () => {
  assert.equal(JSON.parse(encodeResponse({ id: 1, ok: true, result: null })).id, 1);
  assert.throws(() => encodeResponse({ id: 1, event: 'prompt', qr: 'x', ok: true }));
});
