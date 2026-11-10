import assert from 'node:assert/strict'
import test from 'node:test'
import { sandbox, session } from '../vendor/lane128-qishui/test/fixtures/plugin-sandbox.mjs'

test('missing executable reports missing components rather than missing consent', async () => {
  const s = await sandbox([], session, { spawnError: new Error('fork/exec bin/qishui-helper-darwin-arm64: no such file or directory') })
  await assert.rejects(s.api.home(), error => error.code === 'setup' && /缺少原生组件/.test(error.message) && !/请允许/.test(error.message))
})

test('ungranted process permission keeps the permission instruction', async () => {
  const s = await sandbox([], session, { spawnError: new Error('programs have not been granted') })
  await assert.rejects(s.api.home(), error => error.code === 'setup' && /请允许插件启动程序/.test(error.message))
})
