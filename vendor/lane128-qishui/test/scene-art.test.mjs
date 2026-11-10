import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Catalog } from '../helper/catalog.mjs'
import { sandbox, session } from './fixtures/plugin-sandbox.mjs'
import { catalogService, discovery, feed, track } from './fixtures/catalog-service.mjs'

// Local pictures previously overrode fresh provider URLs, including future scenes.
const mode = (id, url) => ({ type: 'scene_mode', text: '官方模式', url_info: url, entity: { feed_scene_mode: typeof id === 'number' ? { scene_mode_id: id } : { sub_queue_type: id } } })
const reply = () => ({ feed_mode_block: [{ title: '官方分组', feed_mode: [
  mode(0, 'https://p3-luna.douyinpic.com/img/current.jpg?revision=2'),
  mode(999999, 'https://p3-luna.douyinpic.com/img/new-scene.jpg'),
  mode('fresh', 'https://p3-luna.douyinpic.com/img/fresh.jpg'),
  mode('familiar', undefined),
  mode(42, 'file:///outside/private.png'),
] }] })
const check = modes => {
  assert.equal(modes.find(mode => mode.id === 'scene:0').imageUrl, 'https://p3-luna.douyinpic.com/img/current.jpg?revision=2')
  assert.equal(modes.find(mode => mode.id === 'scene:999999').imageUrl, 'https://p3-luna.douyinpic.com/img/new-scene.jpg')
  assert.equal(modes.find(mode => mode.id === 'preference:fresh').imageUrl, 'https://p3-luna.douyinpic.com/img/fresh.jpg')
  assert.equal(modes.find(mode => mode.id === 'preference:familiar').imageUrl, undefined)
  assert.equal(modes.find(mode => mode.id === 'scene:42').imageUrl, undefined)
}

test('Node catalogue preserves current official cover URLs and leaves missing or unsafe covers to the host', async () => {
  const catalog = new Catalog(session, { request: async () => reply() })
  check(await catalog.listeningModes())
})

test('standalone presents album covers instead of mode logos without fetching image bytes', async () => {
  const covers = Array.from({ length: 6 }, (_, i) => feed([{ ...track(String(i)), album: { cover_url: `https://example.invalid/album-${i}.jpg` } }]))
  const service = catalogService({ modes: [reply(), reply(), reply()], feed: covers, discover: [discovery([], { more: false })] })
  const s = await sandbox([], session, { sign: true, request: service.request })
  try {
    const stations = await s.api.stations()
    assert.equal(stations.find(mode => mode.id === 'preference:fresh').imageUrl, 'https://example.invalid/album-2.jpg')
    const all = (await s.api.browse({ page: 'scene-modes' })).sections[0].stations
    assert.equal(all.find(mode => mode.id === 'scene:999999').imageUrl, 'https://example.invalid/album-4.jpg')
    const landing = (await s.api.browse({ page: 'listening-modes' })).sections[0].stations
    assert.equal(landing[0].id, 'recommendations')
    assert.ok(landing.every(mode => mode.imageUrl.startsWith('https://example.invalid/album-')))
    assert.ok(service.calls.every(call => call.parsed.hostname === 'api.qishui.com'))
  } finally { await s.api.signOut() }
})
