// Development only: share the complete runtime between folder and ZIP installs.
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { prepareNative, OFFICIAL_SOURCE } from './prepare-native.mjs'
import { buildNative, goCommand } from '../vendor/lane128-qishui/scripts/build-native.mjs'
import { checkDigest, darwinAssets } from '../vendor/lane128-qishui/scripts/runtime-assets.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const upstream = path.join(root, 'vendor/lane128-qishui')
const runtimeFiles = [
  'bin/qishui-helper-darwin-arm64', 'runtime/native/qishui-sign',
  'runtime/native/bdms.node', 'runtime/native/libMetaSecML.dylib',
  'runtime/native/GO-LICENSE', 'runtime/native/NATIVE-BUILD.json', 'runtime/native/SOURCES.json',
]

export async function buildRuntime(destination) {
  const assets = await prepareNative()
  const generated = await buildNative(destination, { target: 'darwin-arm64' })
  const native = path.join(destination, 'runtime/native')
  const files = darwinAssets('arm64').files
  for (const [name, hash] of Object.entries(files)) {
    checkDigest(await readFile(path.join(assets, name)), hash, name)
    await cp(path.join(assets, name), path.join(native, name))
  }
  const goRoot = goCommand(path.join(upstream, 'native/worker'), generated.target, ['env', 'GOROOT'])
  await cp(path.join(goRoot, 'LICENSE'), path.join(native, 'GO-LICENSE'))
  await writeFile(path.join(native, 'SOURCES.json'), JSON.stringify({
    official: OFFICIAL_SOURCE, files,
    upstream: { url: 'https://github.com/lane128/mygo-music-qishui', commit: '5d1223734d33505bcc40a50064f836f34184eabd', localChanges: ['session migration', 'legacy navigation', 'qishui identity and packaging'] },
  }, null, 2) + '\n')
  return generated
}

export async function installRuntime(source, destination) {
  for (const name of runtimeFiles) {
    const input = path.join(source, name), output = path.join(destination, name)
    const info = await lstat(input)
    if (!info.isFile()) throw new Error('Runtime input is not a regular file: ' + name)
    let parent = destination
    for (const segment of name.split('/').slice(0, -1)) {
      parent = path.join(parent, segment)
      await mkdir(parent, { recursive: true })
      if (!(await lstat(parent)).isDirectory()) throw new Error('Runtime output directory is not a real directory')
    }
    try {
      if (!(await lstat(output)).isFile()) throw new Error('Runtime output is not a regular file: ' + name)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await cp(input, output)
    await chmod(output, info.mode & 0o777)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-runtime.mjs')
  await mkdir(path.join(root, '.build'), { recursive: true })
  const stage = await mkdtemp(path.join(root, '.build/runtime-'))
  try {
    await buildRuntime(stage)
    await installRuntime(stage, root)
    console.log('Complete native runtime prepared in bin/ and runtime/native/.')
  } finally { await rm(stage, { recursive: true, force: true }) }
}
