import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Catalog } from '../vendor/lane128-qishui/helper/catalog-core.mjs'
import { sandbox, session } from '../vendor/lane128-qishui/test/fixtures/plugin-sandbox.mjs'
import { catalogService, discovery, modes, feed, track } from '../vendor/lane128-qishui/test/fixtures/catalog-service.mjs'

const modeReply = () => {
  const raw = modes(7)
  for (const entry of raw.feed_mode_block[0].feed_mode) entry.url_info = 'https://example.invalid/mode-logo.png'
  return raw
}
const art = key => `https://example.invalid/album-${key}.jpg`
const music = key => feed([{ ...track(String(900 + Number(key || 0))), album: { cover_url: art(key) } }])

test('home restores real recommendations ahead of discovery and browsing never advances playback', async () => {
  let n = 0
  const responses = Array.from({ length: 30 }, () => call => music(++n))
  const service = catalogService({ modes: [modeReply()], discover: [discovery(['42'])], feed: responses })
  const s = await sandbox([], session, { sign: true, request: service.request })
  try {
    const home = await s.api.home()
    assert.ok(home.sections[0].tracks?.length, 'the first section must activate the native recommendation feature')
    assert.equal(home.sections[0].tracks[0].album.imageUrl, art(1))
    assert.deepEqual(Array.from(home.sections[1].stations, s => s.id), ['recommendations', 'preference:familiar', 'preference:fresh'])
    assert.equal(home.sections[1].stations[0].imageUrl, art(1))
    assert.ok(home.sections.slice(2).some(s => s.stations?.some(s => s.id.startsWith('scene:'))))
    assert.ok(home.sections.at(-1).stations.some(s => s.id === 'radio:42'))
    assert.ok(!JSON.stringify(home).includes('mode-logo.png'))
    assert.equal(s.state.get('feed-first-use'), undefined)
    const before = service.for('feed').length
    const songs = await s.api.stationNext({ id: 'recommendations' })
    assert.equal(service.for('feed').length, before + 1)
    assert.equal(songs.length, 1)
    const actual = service.for('feed').at(-1).body
    assert.equal(actual.feed_counts.mix_session_count, 1)
    assert.deepEqual(actual.played_media, [])
    assert.equal(actual.is_first_request, true)
  } finally { await s.api.signOut() }
})

test('mode artwork uses its own music, caches results and never falls back to a logo', async () => {
  const state = {}
  let calls = 0
  const catalog = new Catalog(session, { state, request: async (_, path, options) => {
    assert.equal(path, '/luna/pc/feed/song-tab')
    assert.deepEqual(options.body.played_media, [])
    calls++
    return music(options.body.feed_preference.scene_mode_id)
  } })
  const input = [{ id: 'scene:42', name: '放松', imageUrl: 'https://example.invalid/logo.png' }]
  const first = await catalog.modeStations(input)
  assert.equal(first[0].imageUrl, art(42))
  assert.equal(input[0].imageUrl, 'https://example.invalid/logo.png')
  await catalog.modeStations(input)
  assert.equal(calls, 1)
  state.modeArtwork.get('scene:42').expires = 0
  await catalog.modeStations(input)
  assert.equal(calls, 2)
})

test('missing artwork retains playable identity; expired sessions must propagate', async () => {
  const input = [{ id: 'scene:0', name: '安静', imageUrl: 'https://example.invalid/logo.png' }]
  for (const response of [async () => feed([]), async () => { throw Object.assign(Error(), { kind: 'network' }) }]) {
    const catalog = new Catalog(session, { request: response })
    const [station] = await catalog.modeStations(input)
    assert.equal(station.id, 'scene:0')
    assert.equal(station.imageUrl, undefined)
  }
  const expired = new Catalog(session, { request: async () => { throw Object.assign(Error(), { kind: 'session' }) } })
  await assert.rejects(expired.modeStations(input), { kind: 'session' })
})

test('artwork probes are bounded and do not create a request for every future mode', async () => {
  let active = 0, maximum = 0, calls = 0
  const catalog = new Catalog(session, { request: async () => {
    calls++; active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    active--
    return feed([])
  } })
  const input = Array.from({ length: 100 }, (_, i) => ({ id: `scene:${i}`, name: String(i), imageUrl: 'https://example.invalid/logo.png' }))
  const result = await catalog.modeStations(input)
  assert.equal(result.length, 100)
  assert.equal(calls, 64)
  assert.ok(maximum <= 6)
  assert.ok(result.every(s => !s.imageUrl))
})

test('artwork cache stays bounded across modes and invalid budgets fail before any request', async () => {
  const state = { modeArtwork: new Map(Array.from({ length: 128 }, (_, i) => [`old:${i}`, { expires: Date.now() + 600000 }])) }
  let calls = 0
  const catalog = new Catalog(session, { state, request: async () => { calls++; return feed([]) } })
  await catalog.modeStations([{ id: 'scene:42', name: '模式' }])
  assert.equal(state.modeArtwork.size, 128)
  assert.equal(state.modeArtwork.has('old:0'), false)
  await catalog.modeStations([{ id: 'scene:42', name: '模式' }])
  assert.equal(calls, 1, 'negative artwork results should briefly cache without using a logo')
  for (const limit of [-1, 1.5, 65]) await assert.rejects(catalog.modeStations([], { limit }), { kind: 'response' })
  assert.equal(calls, 1)
})
