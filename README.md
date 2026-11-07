# 汽水音乐 · MyGo Music 插件

实验性的汽水音乐音源，适用于 [MyGo Music](https://github.com/egoist/mygo-music) 0.1.7+。

## 0.2.0 的实际验证状态

旧版纯 HTTP 扫码路径（0.1.x，错误码 7）已移除，改为 **独立 Electron 会话 + 官方安全 SDK**。

已在 **macOS arm64、MyGo 0.1.7 的真实插件运行时**验证：

- 用户在新辅助窗口扫码后，私有会话取得登录凭据。
- 登录后独立请求验证用户资料；`signIn()` 返回真实账号，而非占位账号。
- 恢复该会话后，首页返回并映射 6 首推荐歌曲，搜索返回并映射 20 条结果。

**仍未验收**：当前已打开的桌面 UI 是否完成切页、下一次全新账号完整扫码、官方二次验证 UI 的真实完成、播放/音质/歌词/歌单完整性。不能从登录成功推断所有音乐功能已可用。故障与验证边界详见 [调查记录](docs/login-investigation.md)。

## 安装

1. MyGo → Settings → Plugins → **+** → `DaviRain-Su/mygo-music-qishui`。
2. 安装 **Node.js 22.12+**。播放转换另需 ffmpeg；macOS 可使用 `brew install node ffmpeg`。
3. 打开插件目录（Settings → Plugins → Show Plugins Folder），进入 `qishui/helper`，明确执行依赖安装：

   ```sh
   npm ci --no-audit --no-fund
   node install.cjs
   ```

   会安装固定版本的 Electron（下载约数百 MB）、React 和二维码库。首次认证会从官方 CDN 下载固定版本安全 SDK，校验 SHA-256 后保存在插件私有数据目录。**没有在仓库中分发官方 SDK 或原生二进制。**

4. 在插件设置中允许启动程序。新版本需要运行 **Node.js → Electron**，不再只有 ffmpeg。
5. **⌘Q 完全退出 MyGo 后重开**。登录提示应显示 `[汽水 0.2.0 SDK]`。

当前仅验证 macOS arm64。读取曲库使用本机 `/Applications/汽水音乐.app/Contents/Resources/app.asar.unpacked/bdms.node` 官方原生 SDK；需要安装官方汽水客户端，但**不读取它已有的 Cookie、账号数据库或浏览器 profile**。其他平台、不同原生 SDK 版本仍需适配。

插件更新可能替换整个插件目录，若 `helper/node_modules` 被移除，请重新执行第 3 步；账号会话在独立的数据目录，不随代码安装目录清除。

## 登录

点击登录，在 MyGo 的二维码上用抖音 App 扫码，并在手机上确认。如服务端要求二次验证，会打开「MyGo · 汽水音乐官方安全验证」窗口，必须正常完成验证，不会自动跳过。

登录必须同时满足：**有有效会话 + 独立用户资料接口验证成功**。MyGo 在 `signIn()` 返回后关闭二维码弹窗并刷新/切换音源，不是另开一个成功网页。

Chromium 可能在服务端已经下发 Cookie 后，仍将确认响应报告为网络失败。插件在这种特定传输错误下会独立验证用户资料；验证不通过仍报错。**明确的服务端拒绝（如 7、2046）不能被旧 Cookie 覆盖成成功。**

## 隐私与权限

- 辅助程序只使用 `plugin-data/qishui/auth-sdk` 下本插件自己的身份和 Chromium 会话，目录仅本人可访问。
- Cookie 通过私有管道传递给插件存储，不出现在进程参数、URL、控制台日志中；不读取其他应用的登录数据。
- 浏览器窗口启用 sandbox、context isolation，禁用 Node 集成；不关闭 webSecurity。仅在私有会话里对固定官方 API 适配 CORS。
- Node 原生程序权限比 JS 沙箱更宽，应只安装可信来源的插件代码。此版本的启动命令名单没有通配符。
- 诊断 `[qishui] login:` 只含版本、阶段、错误码等信息。**不要公开 `storage.json`、`auth-sdk` 目录或抓包中的凭据。**
- 退出登录会清理插件缓存及辅助程序自己的会话，不会退出官方汽水客户端。

## 测试 / 排错

无需构建插件入口：

```sh
node --experimental-vm-modules --test tests/login.test.mjs tests/helper-*.test.cjs
```

单独验证 SDK 是否能启动并生成安全参数（不会输出二维码 token、Cookie 或账号信息）：

```sh
node helper/probe.cjs
```

需要用户参与的独立扫码测试（弹窗、在指定的本插件私有目录保存会话）：

```sh
node helper/probe.cjs --login --data-dir "$HOME/Library/Application Support/MyGo Music/plugin-data/qishui/auth-sdk"
```

MyGo 0.1.7 真实运行时模拟测试，`MYGO_SOURCE` 指向其源码目录：

```sh
cp tests/mygo-login-regression_test.go "$MYGO_SOURCE/internal/plugin/qishui_regression_test.go"
QISHUI_PLUGIN_SOURCE="$PWD/index.js" go -C "$MYGO_SOURCE" test ./internal/plugin -run TestQishuiLoginRegression -count=1 -v
```

这些自动化模拟测试不能代替真实账号验收。参考：[官方 YouTube 插件](https://github.com/egoist/mygo-music-youtube-music)、[Folia 汽水认证适配](https://github.com/2706521883-lgtm/folia-qishui)。
