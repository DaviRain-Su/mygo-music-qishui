// Explicit read-only probe. No credentials, signatures, media URLs or titles are logged.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const args = process.argv.slice(2)
if (args.length !== 3 || !args.every(value => path.isAbsolute(value))) throw new Error('Provide absolute host source, extracted plugin, and private storage paths')
const [hostSource, pluginDir, storage] = await Promise.all(args.map(value => realpath(value)))
const root = fileURLToPath(new URL('..', import.meta.url))
const privateDir = await mkdtemp(path.join(tmpdir(), 'qishui-live-'))
try {
  const audio = path.join(privateDir, 'authorized-audio')
  const overlay = path.join(privateDir, 'overlay.json')
  await writeFile(overlay, JSON.stringify({ Replace: {
    [path.join(hostSource, 'internal/plugin/qishui_readonly_test.go')]: path.join(root, 'test/host-readonly_test.go'),
    [path.join(hostSource, 'internal/player/qishui_readonly_test.go')]: path.join(root, 'test/host-readonly-decode_test.go'),
  } }))
  for (const [pkg, test] of [['plugin', 'Services'], ['player', 'Decode']]) {
    const result = spawnSync('go', ['-C', hostSource, 'test', '-overlay', overlay, '-count=1', '-run', '^TestQishuiReadonly' + test + '$', '-v', './internal/' + pkg], {
      env: { ...process.env, CGO_ENABLED: '0', QISHUI_PLUGIN_DIR: pluginDir, QISHUI_PROBE_STORAGE: storage, QISHUI_PROBE_AUDIO: audio },
      encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000,
    })
    if (result.error) throw new Error('Read-only probe process failed')
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.status !== 0 || !result.stdout.includes('--- PASS: TestQishuiReadonly' + test + ' ')) {
      process.exitCode = 1
      break
    }
  }
} finally {
  await rm(privateDir, { recursive: true, force: true })
}
