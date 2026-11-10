import { error } from './protocol.mjs'
import { discoverySection } from './exploration.mjs'

const PREVIEW_SIZE = 6
const TRACK_PREVIEW_SIZE = 12
const PERSONAL = new Set(['recommendations', 'preference:familiar', 'preference:fresh'])

export const recommendationStation = () => ({ id: 'recommendations', name: '猜你喜欢', description: '根据你的喜好，持续推荐歌曲' })

export function homePage(input) {
  if (!input || typeof input !== 'object') throw error('response')
  const { tracks, stations, discoveries } = input
  if (![tracks, stations, discoveries].every(Array.isArray)) throw error('response')
  const personal = stations.filter(station => PERSONAL.has(station.id))
  const scenes = stations.filter(station => !PERSONAL.has(station.id))
  return {
    title: '汽水音乐',
    subtitle: '听你喜欢的，发现下一首。',
    sections: [
      { title: '为你推荐', pageTitle: '为你推荐', subtitle: '根据你的喜好推荐', tracks: tracks.slice(0, TRACK_PREVIEW_SIZE), empty: '暂时没有推荐歌曲，试试下方的猜你喜欢' },
      ...(personal.length ? [{ title: '按你的口味听', stations: personal }] : []),
      ...(scenes.length ? [{ title: '此刻想听', stations: scenes, morePage: 'listening-modes' }] : []),
      ...(discoveries.length ? [{ ...discoverySection(discoveries.slice(0, PREVIEW_SIZE)), title: '发现更多音乐', morePage: 'listening-modes' }] : []),
    ],
  }
}
