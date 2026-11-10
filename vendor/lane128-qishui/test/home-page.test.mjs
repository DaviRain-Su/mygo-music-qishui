import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Catalog } from '../helper/catalog.mjs'
import { homePage } from '../helper/home-page.mjs'

const discoveries = Array.from({ length: 20 }, (_, i) => ({ type: i === 1 ? 'playlist' : 'radio', item: { id: i === 1 ? '7123456789012345678' : `radio:${i}`, name: `探索 ${i}`, imageUrl: `https://example.invalid/radio-${i}.jpg` } }))

// Recommendations lead the native feature, followed by continuous modes and a small discovery shelf.
test('home leads with real songs and modes while preserving discovery actions and artwork', () => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({ id: String(i), album: { imageUrl: 'https://example.invalid/album.jpg' } }))
  const stations = [{ id: 'recommendations', name: '猜你喜欢' }, { id: 'scene:42', name: '放松' }]
  const home = homePage({ tracks, stations, discoveries })
  assert.equal(home.sections.length, 4)
  assert.deepEqual(home.sections[0].tracks, tracks.slice(0, 12))
  assert.deepEqual(home.sections[1].stations, [stations[0]])
  assert.deepEqual(home.sections[2].stations, [stations[1]])
  const discovery = home.sections[3]
  assert.equal(discovery.morePage, 'listening-modes')
  assert.deepEqual(discovery.playlists, [discoveries[1].item])
  assert.deepEqual(discovery.stations, discoveries.slice(0, 6).filter(d => d.type === 'radio').map(d => d.item))
  assert.equal(discoveries.length, 20)
})

// No fake music or library substitution when recommendation and discovery legitimately return empty.
test('empty responses keep the recommendation destination without fabricated songs', () => {
  const empty = homePage({ tracks: [], stations: [], discoveries: [] })
  assert.equal(empty.sections.length, 1)
  assert.ok(empty.sections[0].empty)
  assert.equal(empty.sections[0].playlists, undefined)
  assert.equal(empty.sections[0].stations, undefined)
  assert.deepEqual(empty.sections[0].tracks, [])
  assert.throws(() => homePage({ tracks: null, stations: [], discoveries: [] }), { kind: 'response' })
})

// Production previews use signed feed metadata, never audio downloads or account mutations.
test('catalog home keeps recommendations when secondary discovery is unavailable', async () => {
  const session = { version: 1, deviceID: '1234567890123456', installID: '123456789012345', cookies: [{ name: 'sessionid', value: 'fixture' }] }
  const catalog = new Catalog(session, { request: async (_, path, options) => {
    assert.equal(options.signed, true)
    if (path === '/luna/pc/feed/song-tab') return { items: [{ type: 'track', entity: { track_wrapper: { track: { id: '91', name: '推荐歌曲', album: { cover_url: 'https://example.invalid/song.jpg' } } } } }] }
    if (path === '/luna/pc/feed/mode') return { feed_mode_block: [] }
    assert.equal(path, '/luna/pc/discover')
    throw Object.assign(Error(), { kind: 'network' })
  } })
  const home = await catalog.home()
  assert.equal(home.sections[0].tracks[0].id, '91')
  assert.equal(home.sections[1].stations[0].id, 'recommendations')
  assert.equal(home.sections.length, 2)
})
