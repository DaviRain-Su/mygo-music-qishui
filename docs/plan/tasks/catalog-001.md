---
id: catalog-001
scope: helper/catalog
status: ready
depends-on: []
---

## objective

实现 docs/features/README.md 中 Catalog 合同的真实读取模块、DTO映射、游标/完整性控制。不得导出无证据的专辑/艺人详情，不把空fallback伪装成功。提供每个公开方法的契约/边界测试。

## context

- docs/INDEX.md
- docs/features/README.md
- /tmp/qishui-feature-read-results.jsonl、/tmp/qishui-feature-read2-results.jsonl、/tmp/qishui-feature-read3-results.jsonl（已脱敏只读结构）
- /tmp/folia/qishui-api.js（参考协议，不拷贝整文件，不把其猜测路径当正确）
- /tmp/mygo-check/internal/music/music.go

## path

- helper/catalog.cjs
- helper/catalog-data.cjs（若需要）
- tests/helper-catalog.test.cjs
- docs/features/catalog.md

不要改 index.js/helper/main.cjs/runtime.cjs/protocol.cjs 或其他任务文件。新模块通过注入api工作，错误构造可以使用既有 fault('response'/'protocol')，需要新的错误类型则明确列在最终handoff供integration添加。

## verification

先写失败测试再实现；node --test tests/helper-catalog.test.cjs。覆盖嵌套实体/封面/毫秒、四类搜索、has_more=false优先、空页/重复/循环游标、未知offset、账号变化清理、喜欢集合完整性、收藏分类、playlist上限、发现和feed状态隔离。对GET既有响应无total/has_more但列表有效的处理需写明，不编造游标。不得读真实账号文件或发网络请求。提交只包含本任务path，最终输出接口和任何blocked点。
