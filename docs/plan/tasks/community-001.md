---
id: community-001
scope: helper/community-and-actions
status: ready
depends-on: []
---

## objective

实现歌词解析与评论列表/发布、具有明确PC路径依据的喜欢/收藏/创建歌单/追加歌曲/played操作。严格不调用未知删除/关注/重排/点赞评论端点。非幂等网络失败报告结果未知，不自动重试、不得伪造创建id。

## context

- docs/features/README.md（Community/Actions合同）
- /tmp/folia/qishui-api.js 的 lyrics/comments/write handlers
- /tmp/qishui-feature-read-results.jsonl（脱敏评论形态）
- /tmp/mygo-check/internal/music/music.go（Lyrics/Comment DTO）

## path

- helper/community.cjs
- helper/actions.cjs
- tests/helper-community.test.cjs
- tests/helper-actions.test.cjs
- docs/features/community.md

不要改其他模块/index/main/runtime/protocol文件。Actions 与 Community 都以注入 api 函数实现，未知新error code列在handoff供集成层添加。Actions.invalidate 需要在状态可能变化时调用，创建/追加必须明确非幂等风险。

## verification

先写测试再代码；node --test tests/helper-community.test.cjs tests/helper-actions.test.cjs。必须覆盖逐字LRC/翻译/无歌词/纯文本/异常时间/超长文本，评论cursor分页/显式结束/缺字段，精确HTTP payload、创建无id、网络未知结果、批量部分成功、缓存失效、不得自动重试。真实账号读写和网络都禁止；测试仅注入合成fixture。提交只包含本任务path，报告未验证的真实写操作。
