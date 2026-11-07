---
id: polish-001
scope: community+actions docs / playback cache / comment author
status: done
depends-on: [community-001, quality-001, integration-001]
---

## objective

根据 `docs/plan/analysis/writes-ux-004.md`：
1. 更新功能合同，写明各写接口成功响应字段；create/like/save/append 保持现有解析，评论继续接受 `created_comment`。
2. `postComment` 成功后若缺 author/avatar，用当前 Features 账号回填，便于 MyGo 立即展示。
3. Playback 内存缓存改为最多 8 条、TTL 30 分钟；`track_v2` 与 `/me` 并行请求以缩短冷启动。

## context

- docs/features/README.md
- docs/features/community.md
- docs/features/quality.md
- docs/plan/analysis/writes-ux-004.md

## path

- helper/community.cjs（如需）
- helper/features.cjs
- helper/playback.cjs
- docs/features/*
- tests/helper-feature-integration.test.cjs
- tests/helper-playback.test.cjs
- tests/helper-community.test.cjs（回归）

## verification

- Node：community / playback / feature-integration 相关测试全绿；全量 helper 测试不回退。
- 离线断言：created_comment 路径带上 account name/avatar；缓存命中不重复 encode；超出 8 条淘汰最旧。
- 不自动对真实账号发新评论/喜欢。
