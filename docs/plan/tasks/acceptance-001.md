---
id: acceptance-001
scope: independent-verification-and-supported-blocked-matrix
status: done
depends-on: [integration-001]
---

## objective

把 0.4.0 已兑现能力与仍 blocked 能力写成可核对矩阵；记录只读线上验收结果；明确用户需手动确认的播放与写操作。

## already observed (read-only)

- home / discover / charts / stations / scene-feed / 四类搜索与翻页：通过
- playlists / liked(72,终页) / isLiked / savedAlbums / recent(417)：通过
- lyrics 结构化解析 + comments 翻页：通过
- 未自动执行 like / save / createPlaylist / addToPlaylist / postComment / played

## remaining user confirmation

- 安装 0.4.0 后 ⌘Q 重启 MyGo，确认登录标识与导航页可用
- 标准/高音质以及授权无损是否真正从扬声器出声
- 用户主动触发的写操作结果

## deliverables

- docs/features/acceptance.md（0.4.5 矩阵）
- docs/features/README.md / backlog 与矩阵一致
- 不宣称原生 App 完整对齐；不发布未经用户确认的 Release 说明夸大词
