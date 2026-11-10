// Full macOS arm64 runtime package. All downloads/builds happen here only.
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { zipSync } from 'fflate'
import { buildRuntime, installRuntime } from './build-runtime.mjs'
import { copyPackageSource, checkPackageLayout } from '../vendor/lane128-qishui/scripts/package-layout.mjs'
import { sha256 } from '../vendor/lane128-qishui/scripts/runtime-assets.mjs'
await import('./build.mjs')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: npm run package -- [--output PATH] (macOS arm64 only)')
const root = fileURLToPath(new URL('..', import.meta.url))
const upstream = path.join(root, 'vendor/lane128-qishui')
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'))
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (manifest.id !== 'qishui' || manifest.version !== metadata.version) throw new Error('Plugin identity/version mismatch')
const dist = path.join(root, '.dist')
const output = args.length ? path.resolve(args[1]) : path.join(dist, `plugin-qishui-${manifest.version}-darwin-arm64.zip`)
await mkdir(dist, { recursive: true })
const stage = await mkdtemp(path.join(dist, '.native-package-'))
try {
  const target = path.join(stage, 'vendor/lane128-qishui')
  await copyPackageSource(upstream, target)
  for (const name of ['legacy-session.mjs', 'legacy-navigation.mjs']) {
    await cp(path.join(upstream, 'helper', name), path.join(target, 'helper', name))
  }
  for (const name of ['plugin.json', 'index.js', 'package.json', 'package-lock.json', 'README.md', 'NOTICE.md', 'LICENSE', 'docs/native-runtime']) {
    await mkdir(path.dirname(path.join(stage, name)), { recursive: true })
    await cp(path.join(root, name), path.join(stage, name), { recursive: true })
  }
  await mkdir(path.join(stage, 'scripts'))
  for (const name of ['build.mjs', 'build-runtime.mjs', 'package.mjs', 'prepare-native.mjs', 'package.py']) await cp(path.join(root, 'scripts', name), path.join(stage, 'scripts', name))
  await buildRuntime(stage)
  const entries = Object.create(null)
  async function collect(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name), relative = prefix + name, info = await lstat(absolute)
      if (info.isSymbolicLink()) throw new Error('Package contains a link: ' + relative)
      if (info.isDirectory()) await collect(absolute, relative + '/')
      else if (info.isFile()) {
        checkPackageLayout([relative.replace(/^vendor\/lane128-qishui\//, '')])
        entries[relative] = [await readFile(absolute), { os: 3, attrs: ((info.mode & 0o777 | 0o100000) << 16) >>> 0 }]
      } else throw new Error('Package contains a special file')
    }
  }
  await collect(stage)
  const bytes = zipSync(entries, { level: 6 })
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, bytes, { flag: 'wx' })
  await installRuntime(stage, root)
  console.log(JSON.stringify({ output, bytes: bytes.length, sha256: sha256(bytes), files: Object.keys(entries).length }))
} finally {
  await rm(stage, { recursive: true, force: true })
}
