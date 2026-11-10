# 测试合同

先增加 `test/migration.test.mjs`，直接通过最终 bundle 与上游宿主夹具执行。Happy path：旧 Cookie 经账户验证提交，新 session 优先；Boundary：解析长度/项数与标记；Error：无效 Cookie、过期、网络失败、验证期间退出、退出后重载。

上游 `test/*.test.mjs` 和 `test/build/*.test.mjs` 覆盖宿主认证、目录、动作和 IPC；`native/worker` 全量及 race 覆盖输入限制、解密、音频容器和回环服务；signer 自测覆盖固定 SDK 和隔离。夹具增加可选最终入口路径，测试根目录生成的实际 bundle。

最终 ZIP：检查 manifest、原生架构/权限/哈希、无符号链接、无 Node/Electron/FFmpeg 及旧启动器、来源和对应源码完整。以最终解压目录执行 worker/signature，用不含 Node/Go/FFmpeg 的 PATH。通过 MyGo Music 0.1.22 的实际插件运行时与安装器测试，不替换用户宿主源码。

真实服务只验证账户、签名后的只读目录及授权音频，不调用真实写接口或 played。模拟测试、真实 HTTP、宿主解码与扬声器试听分别记录。

0.5.1 安装修复：先用 `test/host-folder_test.go` 对实际源码文件夹走 MyGo Open → Install → 原生签名，复现文件夹缺少 bin/runtime 的失败，再验证 `npm run build` 与 `npm run package` 均生成完整目录。对旧 Python 命令做实际打包与 ZIP 原生调用检查，不以“命令返回成功”替代包内容验证。检查缺失组件与未授权的报错分离。

推荐展示：先写最终 bundle 和 Catalog 回归，验证首页先呈现真实推荐 tracks、猜你喜欢入口，情景封面来自相应 feed 歌曲专辑且不使用 Logo。浏览后首次 stationNext 仍为 count=1、空 played_media。边界包含缺图、缓存命中/过期、超过 64 个模式、并发上限 6；错误包含网络降级和失效账号传播。使用宿主 ui.NewTester 渲染明暗主题、点击默认推荐及情景并核对实际 radio id，新增 UI 回归运行 -count=5；这些图片是宿主测试渲染，不声称操作过正在运行的桌面窗口。
