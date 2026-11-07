# 写操作体检与体验完善（analysis）

## 结论

1. **评论发送**：已在 0.4.3 修复。成功体是 `{status_info, created_comment:<id字符串>}`，不是完整 comment 对象。
2. **建歌单 / 加歌 / 收藏歌单**：现场成功形态与当前 Actions 解析兼容，未见同类“成功当失败”问题。
3. **喜欢歌曲**：失败体与其它写接口一致（顶层 `status_code`）；成功路径不依赖业务字段，仅需对象响应。未对用户真实喜欢列表做切换探测。
4. **剩余体验项**：评论本地展示缺作者/头像；播放内存缓存过短；电台侧栏已有，首页无需再发明协议。

## 实测成功响应（一次性探针）

| 动作 | 路径 | 成功关键字段 |
| --- | --- | --- |
| postComment | POST `/luna/pc/comments/create` | `created_comment` (string id) |
| createPlaylist | POST `/luna/pc/me/playlist` | `playlist.id` (+ title/owner/…) |
| addToPlaylist | POST `/luna/pc/me/playlist/media/append` | `status_code:0`, `media`, `playlist` |
| savePlaylist on | POST `/luna/pc/me/collection/playlist` | `playlist_ids` |
| savePlaylist off | POST `.../playlist/delete` | `deleted_playlists` |

失败常见：`status_code` 1000004 `ERR_INVALID_PARAM`、1000005 `ERR_RESOURCE_NOT_FOUND`；坏 append 可能非 JSON HTTP 500 → 应落 `mutation-unknown`。

探针曾创建临时歌单 `MyGo探针-可删-*`（id `7705035415274749995`），可在官方客户端删除。

## 模块任务拆分

| 任务 | 目标 |
| --- | --- |
| polish-001 | 评论 `created_comment` 路径回填当前账号昵称/头像；固化写响应合同文档 |
| polish-001（同交付） | Playback 缓存 8 条 / 30 分钟 TTL；metadata 与 `/me` 并行 |
| backlog | 电台 UI 分组 / 持久磁盘缓存 / Hi-Res 等仍缺协议或宿主能力 |

## 不纳入本轮

- 猜测 destructive 删除歌单 API
- 自动对真实喜欢列表反复 like/unlike
- 宣称桌面首播延迟已接近官方客户端（解密+ffmpeg 固有成本仍在）
