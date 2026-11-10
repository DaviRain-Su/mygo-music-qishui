// Build-time preparation only; the installed plugin never downloads programs.
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, stat, rename, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDigest, darwinAssets } from '../vendor/lane128-qishui/scripts/runtime-assets.mjs'
export const OFFICIAL_SOURCE = {
  version: '3.7.0', platform: 'darwin-arm64',
  url: 'https://lf-luna-release.qishui.com/obj/luna-release/3.7.0/452316191/SodaMusic-v3.7.0-official-darwin_arm64.tgz',
  sha256: '40c6bc80aa32cd1d5c76ad1b05bccc67e5ec22cf779b6dc3617ee5432b88ee04',
}
export async function prepareNative() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Only macOS arm64 packages are currently supported')
  const root = fileURLToPath(new URL('../.build/', import.meta.url))
  await mkdir(root, { recursive: true })
  const archive = path.join(root, 'SodaMusic-v3.7.0-official-darwin_arm64.tgz')
  try { await stat(archive) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const response = await fetch(OFFICIAL_SOURCE.url, { signal: AbortSignal.timeout(180000) })
    if (!response.ok || !response.body) throw new Error('Official archive download failed')
    const temporary = archive + '.partial'
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
    await rename(temporary, archive)
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  if (hash.digest('hex') !== OFFICIAL_SOURCE.sha256) throw new Error('Official archive SHA-256 mismatch')
  const list = spawnSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (list.error || list.status !== 0) throw new Error('Cannot inspect verified official archive')
  const destination = path.join(root, 'official-3.7.0-darwin-arm64')
  await mkdir(destination, { recursive: true })
  for (const [name, digest] of Object.entries(darwinAssets('arm64').files)) {
    const entries = list.stdout.split('\n').filter(entry => entry.endsWith('/' + name))
    if (entries.length !== 1) throw new Error('Official archive has an ambiguous native asset: ' + name)
    const result = spawnSync('/usr/bin/tar', ['-xOf', archive, entries[0]], { maxBuffer: 32 * 1024 * 1024 })
    if (result.error || result.status !== 0) throw new Error('Cannot read verified official asset: ' + name)
    checkDigest(result.stdout, digest, name)
    const output = path.join(destination, name)
    await writeFile(output, result.stdout)
    await chmod(output, 0o755)
  }
  return destination
}
