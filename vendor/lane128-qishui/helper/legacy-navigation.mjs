// Preserve the original qishui discovery/chart pages using the shared DTOs.
import { trackOf, playlistOf, albumOf, artistOf } from './catalog-core.mjs'
import { error } from './protocol.mjs'
export function legacyDiscovery(raw, charts, accountId) {
  let visited = 0
  const list = value => {
    if (!Array.isArray(value) || value.length > 5000) throw error('response')
    return value
  }
  const sections = []
  for (const block of list(raw?.blocks)) {
    for (const inner of list(block?.inner_block)) {
      if (++visited > 5000) throw error('response')
      const section = { title: String(inner?.title || block.title || '').slice(0, 4096), tracks: [], albums: [], artists: [], playlists: [] }
      for (const resource of list(inner?.resources)) {
        if (++visited > 5000) throw error('response')
        const entity = resource?.entity ?? resource
        if (!entity || typeof entity !== 'object') throw error('response')
        if (entity.ranked_track?.track) section.tracks.push(trackOf(entity.ranked_track.track))
        else if (!charts) {
          if (entity.track) section.tracks.push(trackOf(entity.track))
          if (entity.playlist) section.playlists.push(playlistOf(entity.playlist, accountId))
          if (entity.album) section.albums.push(albumOf(entity.album))
          if (entity.artist) section.artists.push(artistOf(entity.artist))
        }
      }
      if (['tracks', 'albums', 'artists', 'playlists'].some(key => section[key].length)) sections.push(section)
    }
  }
  return { title: charts ? '榜单' : '发现', sections }
}
