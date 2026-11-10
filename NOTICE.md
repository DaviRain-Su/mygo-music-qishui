# 来源与许可证

本版本基于 lane128/mygo-music-qishui v1.0.11，固定 commit
`5d1223734d33505bcc40a50064f836f34184eabd`：
https://github.com/lane128/mygo-music-qishui

对应源码位于 `vendor/lane128-qishui/`。保留原项目 AGPL-3.0-only 许可证、
完整上游 `NOTICE.md`、N-API 头文件及其 Node 许可证。
原项目基于 mygo-cloudmusic 的协议/接口实践，原作者署名与其他来源见该 NOTICE。

本地修改：保留 `qishui` 身份；旧 sdk-v1 Cookie 经服务器验证后迁移；
退出防止旧会话恢复；兼容原有发现、榜单与历史导航，发现响应限制调整为 8 MiB；
构建根入口与本项目平台包；构建后保留完整文件夹运行组件，旧 Python 打包入口兼容原生包；
缺少程序时给出组件错误；测试夹具允许指定最终入口。
首页恢复个性推荐优先，听歌模式以实际音乐封面展示，浏览预览与播放会话分开。
根目录 `helper/*.cjs` 是旧架构源码，不属于新运行包。

官方 3.7.0 `bdms.node`、`libMetaSecML.dylib` 是官方专有二进制，
不适用本项目 AGPL，也不意味着官方授权或合作。官方 URL、
归档及文件 SHA-256 记录在 `runtime/native/SOURCES.json` 与构建源码中。
这些组件固定与 C++ shim 配套，不使用本机官方 App 或旧缓存。

包内 Go 运行时许可见 `runtime/native/GO-LICENSE`；
本机原生程序使用 ad hoc 签名，未做 Apple notarization。
安装包不包含 Node、Electron、FFmpeg，不在运行时下载这些程序。
