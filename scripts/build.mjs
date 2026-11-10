// Development only. MyGo loads the generated standalone root entry.
import { readFile, writeFile } from 'node:fs/promises'
await import('../vendor/lane128-qishui/scripts/build.mjs')
const source = await readFile(new URL('../vendor/lane128-qishui/index.js', import.meta.url), 'utf8')
const output = new URL('../index.js', import.meta.url)
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== source) throw new Error('Root index.js is stale; run npm run build')
} else await writeFile(output, source)
