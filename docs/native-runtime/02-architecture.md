# 架构与来源

固定上游 commit `5d1223734d33505bcc40a50064f836f34184eabd`，源码保存在 `vendor/lane128-qishui/`，保留 AGPL、NOTICE、Node N-API 头文件许可及原生源码。根目录入口由 vendored `src/plugin.mjs` 生成；根目录 manifest 保留本项目身份。旧 `helper/*.cjs` 仅保留为历史源码，不进入运行包。

宿主 JS 负责扫码、账户验证、Cookie 存储及官方 API HTTP；Go worker 接收 JSONL，仅负责签名调度和授权音频下载、解密、封装及回环服务。C++ signer 在隔离子进程中加载固定官方 3.7.0 原生组件，无 JS 引擎。AAC-LC 使用 M4A，FLAC 直接输出，MyGo 解码。

新增旧会话适配器只读 `authBackend` 和 `cookie`，不访问磁盘会话，不信任旧 `account`。验证成功才保存 `session`；完成迁移、明确过期或退出后持久标记，防止旧 Cookie 在下次启动时复活。网络错误保留重试机会。账号切换与迟到响应沿用上游 generation 防护。

构建依赖仅用于开发：Node/esbuild/fflate、Go 1.27、Apple C++。ZIP 包含对应源码与构建配方；固定官方文件通过归档与逐文件 SHA-256 双重核验。第三方原生二进制不适用项目 AGPL，来源和权利边界见 NOTICE。

推荐展示继续使用共享 Catalog 和现有官方推荐接口：首页与模式封面采用独立、无播放反馈的预览请求，连续播放仍由插件的 feedStates 管理。专辑封面缓存属于当前账号 catalogState，退出即丢弃；宿主原生主卡、模式卡片和链接承担布局，不修改 MyGo 安装程序。
