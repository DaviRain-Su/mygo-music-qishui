---
id: playlist-writes-001
scope: actions playlist rename/delete/remove + acceptance closeout
status: done
depends-on: [polish-001]
---

## objective

1. 按 `docs/plan/analysis/playlist-writes-005.md` 实现 `renamePlaylist` / `deletePlaylist` / `removeFromPlaylist`。
2. 接入 Features/index 导出；写入缓存失效；mutation-unknown 语义与 addToPlaylist 一致（remove 逐曲）。
3. 关闭 acceptance-001：刷新 supported/blocked 矩阵到 0.4.5。
4. 不实现 reorder / album / artist / suggest / likeComment / disk cache。

## context

- docs/features/README.md
- docs/plan/analysis/playlist-writes-005.md
- docs/plan/tasks/acceptance-001.md

## path

- helper/actions.cjs
- helper/features.cjs
- index.js
- docs/features/*
- docs/plan/*
- locales/zh-CN.json
- tests/helper-actions.test.cjs
- tests/helper-feature-integration.test.cjs
- tests/mygo-login-regression_test.go
- tests/login.test.mjs（若涉及 mutation 名单）

## verification

- Node：actions / feature-integration / 全量 helper 测试通过
- 离线断言三条写路径的精确 payload；remove 部分成功带 confirmed
- 不自动对真实账号再发 destructive 写；探针歌单已删除
