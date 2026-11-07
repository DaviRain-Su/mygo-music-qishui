---
id: catalog-002
scope: catalog-live-protobuf-compatibility
status: done
depends-on: [catalog-001]
---

## objective

修复实际只读验收暴露的PC protobuf终页省略问题，不再多抓一页使喜欢列表报错，或把history total_num当精确累计数而误报pagination。

## context

- docs/features/README.md 的最新省略值合同
- /tmp/qishui-catalog-read-acceptance.jsonl（脱敏结果：liked response失败、recent pagination失败）
- /tmp/qishui-library-shape-diagnosis.jsonl（安全字段/计数）
- /tmp/qishui-liked-debug-safe.jsonl（终页字段省略和固定路径栈，无用户标识）

## path

- helper/catalog.cjs
- tests/helper-catalog.test.cjs
- docs/features/catalog.md

## verification

只有 has_more===true 续页；missing或false终止。未知非boolean仍失败。more=true缺cursor/list或循环仍失败。不从next_cursor/total_num猜更多。对有效playlist metadata匹配id的终页允许省略media_resources空数组；其他已知列表用status_info有效等成功上下文，不能任意{}=>空。测试先复现真实终页残留cursor、history total大于累计、空歌单字段省略，再修复，保留已有取消/边界保护。不碰integration文件。不发网络/读账号。报告新契约以及测试count。
