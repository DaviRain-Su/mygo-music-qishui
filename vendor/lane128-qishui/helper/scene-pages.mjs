// MyGO owns card dimensions and typography. Keep the eight-mode preview flat;
// the common-mode section's morePage retains access to the complete catalog.
import { error } from './protocol.mjs'
import { discoverySection } from './exploration.mjs'

const station = mode => ({ id: mode.id, name: mode.name, description: mode.description || mode.group, imageUrl: mode.imageUrl })
export function scenePage(modes, page = 'listening-modes', discoveries = []) {
  if (!Array.isArray(modes)) throw error('response')
  if (page === 'scene-modes') {
    return { title: '全部听歌模式', subtitle: '点击模式持续播放', sections: modes.length ? [{ stations: modes.map(station) }] : [] }
  }
  if (page !== 'listening-modes') throw error('unsupported')
  return { title: '听歌模式', subtitle: '选一个模式，让喜欢的音乐接着放', sections: [
    ...(modes.length ? [{ title: '常用模式', stations: modes.slice(0, 8).map(station), ...(modes.length > 8 ? { morePage: 'scene-modes' } : {}) }] : []),
    ...(discoveries.length ? [discoverySection(discoveries)] : []),
  ] }
}
