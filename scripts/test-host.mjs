// Go overlay exercises the real MyGo host without editing its checkout.
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
if (args.length !== 3 || !args.every(value => value && path.isAbsolute(value))) throw new Error('Provide absolute host source, extracted plugin and ZIP paths')
// Go canonicalizes /tmp to /private/tmp before resolving overlay keys.
const [hostSource, pluginDir, zip] = await Promise.all(args.map(value => realpath(value)))
const output = path.join(root, '.build/host-check')
await mkdir(output, { recursive: true })
let source = await readFile(path.join(root, 'vendor/lane128-qishui/test/host_integration_test.go'), 'utf8')
source = source.replaceAll('qishui-app-login', 'qishui')
const anchor = 'case "/luna/pc/discover":'
if (!source.includes(anchor)) throw new Error('Upstream host fixture changed')
source = source.replace(anchor, anchor + `
            // Existing discovery/charts send the original mixed-content request.
            if !payload.FirstRequest && !payload.NewDiscovery {
                result = map[string]any{"blocks": []any{}}
                break
            }
`)
const fixture = path.join(output, 'qishui_native_test.go')
await writeFile(fixture, source)
const overlay = path.join(output, 'overlay.json')
await writeFile(overlay, JSON.stringify({ Replace: {
  [path.join(hostSource, 'internal/plugin/qishui_native_test.go')]: fixture,
  [path.join(hostSource, 'internal/plugin/qishui_folder_test.go')]: path.join(root, 'test/host-folder_test.go'),
} }))
const result = spawnSync('go', ['-C', hostSource, 'test', '-overlay', overlay, '-count=1', '-run', '^TestQishuiPlugin(Runtime|NetworkOnlyLogin|ZipInstall|FolderInstall|MissingComponents)$', '-v', './internal/plugin'], {
  env: { ...process.env, CGO_ENABLED: '0', QISHUI_PLUGIN_DIR: pluginDir, QISHUI_PLUGIN_ZIP: zip, QISHUI_SOURCE_DIR: root },
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})
if (result.error) throw result.error
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.status === 0) {
  for (const name of ['Runtime', 'NetworkOnlyLogin', 'ZipInstall', 'FolderInstall', 'MissingComponents']) {
    if (!result.stdout.includes('--- PASS: TestQishuiPlugin' + name + ' ')) throw new Error('Required host test did not execute: ' + name)
  }
}
process.exitCode = result.status ?? 1
