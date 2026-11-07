# 功能对齐交付计划

比较基线和完整合同：[features/README.md](../features/README.md)。用户授权目标是补齐功能；未授权自动化修改真实账号。SDK运行与播放的既有状态需保留。

## 任务与执行方式

| 任务 | 目标 | 状态 | 依赖 |
| --- | --- | --- | --- |
| catalog-001 | 分类搜索、库/详情分页、喜欢/收藏专辑、历史、发现/模式 | done（模块，37项测试+独立复审） | — |
| catalog-002 | PC protobuf终页省略兼容（liked/recent） | done（模块，45项测试+独立复审） | catalog-001 |
| community-001 | 歌词、评论、来源明确的账号写动作 | done（模块，20项测试+独立复审） | — |
| community-002 | 评论终页省略与歌词翻译时间排序 | done（模块，24项测试+独立复审） | community-001 |
| quality-001 | 真实FLAC无损契约与安全兼容性，不伪装AAC为无损 | done（模块，19项测试+独立复审） | — |
| integration-001 | helper路由、全部可兑现exports、导航、缓存失效、安装包/文档 | done（0.4.0，159项Node+独立复审+只读线上验收） | catalog/community/quality |
| covers-001 | 封面/电台图标 CDN 模板后缀 | done（直播探测+聚焦测试） | catalog-001 |
| acceptance-001 | 独立验证、只读线上验收、已支持与blocked清单 | in-progress | integration-001 |
| covers-001 | 封面/电台图标 CDN 模板后缀 | done（直播探测+聚焦测试） | catalog-001 |
| acceptance-001 | 独立验证、只读线上验收、已支持与blocked清单 | pending | integration-001 |

三个模块路径互不重叠，分别使用 git worktree；实现提交后由全新verify agent审查，blocking修复后才合并。集成单独任务，必须测试真实模块而不是只mock JSONL返回。

## 已完成的探索

两名只读审计agent分别检查MyGo/参考PC接口和原生UI/音质差异；独立核验指出分页/写入失败/未知路由的交付风险。这些风险已写入合同。本机只读探测证实分类搜索独立路径、mixed_collections、历史、feed mode和discover形态；专辑/艺人详情猜测路径不可用，不能发布为可用功能。

## 不纳入“已完成”的项目

- 无可靠PC路由证据的歌单重命名/删除/移除/重排、艺人关注、评论点赞、建议、专辑/艺人完整详情。
- 官方支付、直播视频、完整社交/隐私、专有DSP、独立Hi-Res档位：需要宿主扩展或额外授权接口。
- 线上账号写操作仅在用户主动使用时执行；离线契约测试通过不等于真实写操作已经验证。

持续更新状态和 reviews，不用“所有功能都完成”掩盖 blocked 项。
