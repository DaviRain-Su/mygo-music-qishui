import assert from 'node:assert/strict'
import test from 'node:test'
import { sandbox, session, json } from '../vendor/lane128-qishui/test/fixtures/plugin-sandbox.mjs'
const blocks = [{ title: '热门', inner_block: [{ title: '热歌榜', resources: [
  { entity: { ranked_track: { track: { id: '91', name: 'Song', duration: 1000 } } } },
  { entity: { playlist: { id: '94', title: 'List', count_tracks: 1 } } },
] }] }]

for (const page of ['discover', 'charts']) test(`existing ${page} navigation remains usable`, async () => {
  const s = await sandbox([], session, { sign: true, request: url => {
    assert.equal(new URL(url).pathname, '/luna/pc/discover')
    return json({ blocks })
  } })
  const result = await s.api.browse({ page })
  assert.equal(result.sections[0].tracks[0].id, '91')
  assert.equal(result.sections[0].playlists.length, page === 'charts' ? 0 : 1)
})

test('history navigation reads the existing history interface', async () => {
  const s = await sandbox([], session, { sign: true, request: url => {
    assert.equal(new URL(url).pathname, '/luna/pc/me/recently-played-media')
    return json({ resources: [], has_more: false })
  } })
  assert.equal((await s.api.browse({ page: 'history' })).title, '最近播放')
})

for (const extra of [0, 1]) test(`mixed discovery enforces an 8 MiB response boundary: extra=${extra}`, async () => {
  const limit = 8 * 1024 * 1024
  const envelope = { blocks, padding: '' }
  envelope.padding = 'x'.repeat(limit - Buffer.byteLength(JSON.stringify(envelope)) + extra)
  const s = await sandbox([], session, { sign: true, request: () => json(envelope) })
  if (extra) await assert.rejects(s.api.browse({ page: 'discover' }))
  else assert.equal((await s.api.browse({ page: 'discover' })).sections[0].tracks[0].id, '91')
})
