# 歌单写操作补齐（analysis）

## 新确认的 PC 路径（一次性探针，已清理）

| MyGo 能力 | 路径 | body | 成功关键字段 |
| --- | --- | --- | --- |
| renamePlaylist | POST `/luna/pc/me/playlist/update` | `{playlist_id,name}` | `playlist_id`,`name`,`playlist` |
| deletePlaylist | POST `/luna/pc/me/playlist/delete` | `{playlist_ids:[id]}` | `deleted_playlists` |
| removeFromPlaylist | POST `/luna/pc/me/playlist/media/delete` | `{playlist_id,media:[{id,type:'track'}]}` | `media`,`playlist` |

## 仍不可用

- `movePlaylistTrack`：`/me/playlist/media/reorder` → HTTP 404
- 专辑/艺人详情、search sug、关注艺人、评论点赞：无可用 PC 映射
- 跨重启磁盘缓存 / 队列预取：隐私与 helper 生命周期未设计，本轮不做

## 探针清理

临时歌单 `7705035415274749995` 已通过真实 `playlist_ids` 删除接口删除；详情再查返回 1000005。

## 任务

- playlist-writes-001：实现并导出上述三项；更新合同/backlog/acceptance；版本 0.4.5
