import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const tests = []
for (const dir of ['test', 'vendor/lane128-qishui/test', 'vendor/lane128-qishui/test/build']) {
  for (const name of await readdir(new URL('../' + dir + '/', import.meta.url))) {
    if (name.endsWith('.test.mjs')) tests.push(dir + '/' + name)
  }
}
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...tests], {
  cwd: root, stdio: 'inherit', env: { ...process.env, QISHUI_PLUGIN_ENTRY: root + '/index.js' },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
