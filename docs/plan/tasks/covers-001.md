---
id: covers-001
scope: cdn-cover-and-station-icon-urls
status: done
depends-on: [catalog-001]
---

## objective

修复歌曲封面、专辑图、歌单图、情景电台图标在 MyGo 中不可显示的问题。

## evidence

- `/tmp/qishui-cover-template-probe2.jsonl`：`urls+uri` 裸拼 → 400；`~c5_400x400.jpg` 与 `~{template_prefix}-resize:400:400.webp` → 200 image/*
- 情景电台 PNG：`~c5_*` → 403；必须用 template_prefix resize
- 连续推荐电台逻辑已存在（stations/stationNext/home morePage）；本任务只修图标/封面URL，不改 feed 协议

## path

- helper/catalog.cjs (`image`)
- tests/helper-catalog.test.cjs
- tests/login.test.mjs（若断言裸URL）
- docs/features/catalog.md / README（合同已更新）

## verification

TDD：先让现有封面断言改为要求变换后缀并新增 template_prefix/scene 回归；再实现。聚焦 catalog + 相关 login 桥接测试。不联网、不读账号文件。
