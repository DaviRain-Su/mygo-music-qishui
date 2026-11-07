---
id: community-002
scope: community-terminal-pages-and-translation-order
status: ready
depends-on: [community-001]
---

## objective

根据实际PC protobuf默认false会省略的合同，让评论终页正确结束；同时修复已审查非阻塞的乱序翻译竞争与宿主顺序不一致。

## context

- docs/features/README.md 最新评论合同
- docs/features/community.md
- docs/plan/backlog.md
- /tmp/mygo-check/internal/lyrics/lyrics.go：Build按时间稳定排序翻译，再作近邻匹配

## path

- helper/community.cjs
- tests/helper-community.test.cjs
- docs/features/community.md

## verification

TDD覆盖comments有list但has_more省略（more=false）、cursor残留不导致more、明确成功/有count的空终页省略comments、非法more类型仍失败、more=true缺数据仍失败；保留未知offset/重复cursor保护。翻译先稳定排序时间再分配，测试乱序多个translation抢同一line和1.5s边界。不能改Actions或其他模块。禁止网络/账号读写，报告focused tests。
