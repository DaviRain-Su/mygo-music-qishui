import assert from 'node:assert/strict'
import test from 'node:test'
import { sandbox, profileReply, session, json, until } from '../vendor/lane128-qishui/test/fixtures/plugin-sandbox.mjs'

const marker = 'native-migration-v1'
function oldState(s) {
  s.state.set('authBackend', 'sdk-v1')
  s.state.set('cookie', 'sessionid=legacy-session; other=value')
  s.state.set('account', { id: 'stale', name: 'Unverified' })
}

test('legacy account is verified before committing; original data is retained', async () => {
  let release
  const s = await sandbox([], undefined, { allowSpawn: false, request: url => {
    if (new URL(url).pathname === '/luna/pc/me') return new Promise(resolve => { release = resolve })
  } })
  oldState(s)
  const pending = s.api.account()
  await until(() => release)
  assert.equal(s.state.has('session'), false)
  release(profileReply())
  const account = await pending
  assert.equal(account.name, '测试账号')
  assert.equal(s.state.get('session').account.id, account.id)
  assert.equal(s.state.get(marker), 1)
  assert.equal(s.state.get('account').id, 'stale')
  assert.equal(s.state.get('cookie'), 'sessionid=legacy-session; other=value')
  assert.equal(s.spawned(), 0)
})

test('existing native session takes precedence', async () => {
  const s = await sandbox([], session, { replies: [profileReply()], allowSpawn: false })
  oldState(s)
  await s.api.account()
  assert.equal(s.state.get('session').deviceID, session.deviceID)
  assert.equal(new Headers(s.authCalls[0].options.headers).get('cookie').includes('legacy-session'), false)
})

test('expired legacy session is not retried after reload', async () => {
  const s = await sandbox([], undefined, { replies: [json({}, [], 401)], allowSpawn: false })
  oldState(s)
  assert.equal(await s.api.account(), null)
  assert.equal(s.state.get(marker), 1)
  assert.equal(await s.api.account(), null)
  const reloaded = await sandbox([], undefined, { allowSpawn: false })
  oldState(reloaded)
  reloaded.state.set(marker, s.state.get(marker))
  assert.equal(await reloaded.api.account(), null)
  assert.equal(reloaded.authCalls.length, 0)
})

test('an expired native session cannot fall back to another old account', async () => {
  const s = await sandbox([], session, { replies: [json({}, [], 401)], allowSpawn: false })
  oldState(s)
  assert.equal(await s.api.account(), null)
  assert.equal(await s.api.account(), null)
  assert.equal(s.authCalls.length, 1)
  assert.equal(s.state.get(marker), 1)
})

test('network failure preserves a legacy session for retry', async () => {
  let attempts = 0
  const s = await sandbox([], undefined, { allowSpawn: false, request: url => {
    if (new URL(url).pathname !== '/luna/pc/me') return
    if (++attempts === 1) throw new TypeError('synthetic network failure')
    return profileReply()
  } })
  oldState(s)
  await assert.rejects(s.api.account())
  assert.equal(s.state.has('session'), false)
  assert.equal(s.state.has(marker), false)
  assert.equal((await s.api.account()).name, '测试账号')
})

test('sign out blocks late legacy verification and future resurrection', async () => {
  let release
  const s = await sandbox([], undefined, { allowSpawn: false, request: url => {
    if (new URL(url).pathname === '/luna/pc/me') return new Promise(resolve => { release = resolve })
  } })
  oldState(s)
  const pending = s.api.account()
  await until(() => release)
  await s.api.signOut()
  release(profileReply())
  assert.equal(await pending, null)
  assert.equal(s.state.has('session'), false)
  const reloaded = await sandbox([], undefined, { allowSpawn: false })
  oldState(reloaded)
  reloaded.state.set(marker, s.state.get(marker))
  assert.equal(await reloaded.api.account(), null)
  assert.equal(reloaded.authCalls.length, 0)
})

for (const [label, cookie] of [
  ['empty', ''], ['missing session', 'other=value'], ['newline', 'sessionid=x\r\ninjected=x'],
  ['duplicate', 'sessionid=x; sessionid=y'], ['oversized', 'sessionid=' + 'x'.repeat(16384)],
  ['too many cookies', 'sessionid=x; ' + Array.from({ length: 128 }, (_, i) => `c${i}=x`).join('; ')],
]) test(`invalid legacy cookie: ${label}`, async () => {
  const s = await sandbox([], undefined, { allowSpawn: false })
  oldState(s)
  s.state.set('cookie', cookie)
  assert.equal(await s.api.account(), null)
  assert.equal(s.authCalls.length, 0)
  assert.equal(s.state.has('session'), false)
})
