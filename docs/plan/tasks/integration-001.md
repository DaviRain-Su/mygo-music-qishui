---
id: integration-001
scope: plugin-helper-feature-integration
status: in-progress
depends-on: [catalog-001, community-001, quality-001]
---

## objective

连接已审查的三个真实模块到 MyGo exports/JSONL/runtime，完成导航、缓存生命周期、错误映射、FLAC返回类型、文档与安装包集成。不只是导出函数/返回fixture。

## context

- docs/INDEX.md、docs/features/README.md
- docs/features/catalog.md、community.md、quality.md
- /tmp/mygo-check/internal/music/music.go 和 internal/lyrics/lyrics.go
- 三项任务最新review/handoff

## path

- index.js
- helper/runtime.cjs
- helper/features.cjs（独立可测的固定方法派发/超时/生命周期适配层）
- helper/main.cjs
- helper/protocol.cjs
- plugin.json
- helper/package.json、helper/package-lock.json（仅自身version，不改依赖）
- locales/zh-CN.json
- tests/login.test.mjs
- tests/helper-feature-integration.test.cjs（新）
- tests/mygo-login-regression_test.go
- docs/features/integration.md
- README.md
- scripts/package.py（如打包需包含新增文档）

## interface

新增 JSONL `catalog`，params `{method,args}`；在独立 helper/features.cjs 中集中实例化真实模块并固定白名单dispatch，Runtime只注入API/账号，main只转发。不接受动态对象属性调用（尤其constructor/__proto__），不暴露模块内部clear/invalidator等RPC。这个模块允许离线贯通测试，不需要mock ElectronRuntime来替代实际feature实现。

Catalog读方法：home,browse,search,playlists,playlist,liked,isLiked,savedAlbums,recent,stations,stationNext。
Community：lyrics,comments,postComment。
Actions：like,savePlaylist,saveAlbum,createPlaylist,addToPlaylist,played。

index.js 采用上述方法的薄桥导出，保留认证/播放路径；不要继续保留旧的错误字段映射实现。`addToPlaylist({id,trackIds})`适配 Actions `{playlistId,ids}`。createPlaylist 成功真实id后标记 mine:true。`played`只由宿主played回调调用，不在stream调用中上报。

新增 browse导航：发现、榜单、历史、电台、收藏专辑，加原home/liked。不导出没有可靠路径的 album/artist详情、followArtist、rename/delete/remove/reorder、likeComment、suggest占位函数或shows/remote模式。

注册模块的新错误码（包括pagination/input/limit/mutation-unknown/cache）和partial confirmed计数，固定中文安全文案；仍不能透传原始响应/URL/凭据。未知结果文案不得鼓励自动重试。

每次catalog调用的总预算25秒，桥超时28秒，Runtime.api必须接受共享AbortSignal以覆盖所有分页/账号读请求（可用AsyncLocalStorage传递单次调用上下文）。调用终止后不可继续刷新cache。signOut/login/reset清理Catalog、Community状态，取消在途读取/阻止跨账号返回；写入中止可能已远端执行，按unknown结果处理。

FLAC：index stream严格按真实result.type支持 .mp3/.flac，相应extension一致且仍限定auth-sdk/audio-cache/run-*/随机名路径；quality/bitrate遵从实际输出，不将high/AAC标lossless。

## verification

- 实现前新增真实Catalog/Community/Actions模块接入的离线测试：mock底层HTTP api而非返回现成DTO，保证index export → RPC派发 → 真实模块路径贯通。
- Node全测 + 源码语法；MyGo0.1.7真实moejs/host.spawn回归需覆盖新增exports/FLAC类型；真实安装器目录+ZIP通过。
- 不读取账号数据，不发真实请求，不执行真实账号写操作。线上只读验收由单独明确的orchestrator任务负责。
- 只能修改本task path；需要更改已合并模块时先在handoff说明阻塞，不悄悄改它们。
- 不擅自发布/推送/改用户安装目录。commit受sandbox阻止时报告，由orchestrator处理。
