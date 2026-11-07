# 汽水音乐 · MyGo Music 插件

实验性的汽水音乐音源，适用于 [MyGo Music](https://github.com/egoist/mygo-music) 0.1.7+。

## 0.3.0：基础播放与功能范围

**没有实现汽水的全部页面。** 当前状态：

| 功能 | 状态 |
| --- | --- |
| 登录、恢复会话、账号校验 | 已在本机真实账号验证 |
| 首页推荐、歌曲搜索 | 已能读取并显示歌曲，完整分页仍待完善 |
| 基础播放 | 0.3.0 新接入授权音频解码和 MP3 转换；真实标准/高音质样本可解码为非静音音频，桌面实际出声仍待用户确认 |
| 歌单、喜欢列表 | 初步接口，完整字段和分页未验收 |
| 专辑、歌手详情、歌词、评论、收藏写入 | 尚未完整实现 |
| 无损/Hi-Res/空间音频 | 当前不提供，输出为 128/192 kbps MP3 |

0.2.x 读取错了播放地址字段，并未处理 CENC 加密，所以“能看到歌但都播不了”。0.3.0 从 `track_player.video_model` 读取当前账号的授权流，检查音质权益，在内存中解码后用 ffmpeg 转 MP3，以本地文件交给 MyGo。密钥不会进入命令行、日志或磁盘；明确需要购买但无法证明权益的流不会播放，试听不会冒充完整歌曲。

本机真实样本验收：标准音质准备约 2.6 秒，高音质约 5.2 秒；均再次解码出 441000 字节/5秒非静音 PCM。第一次播放需要等待下载和转码，最多25秒；当前缓存最多3首，登出/辅助程序退出时清理。详见 [播放修复记录](docs/auth-sdk/05-playback-fix.md)。

## 0.2.1 保留的安装修复

0.2.0 曾把 `node_modules`/Electron 放在插件代码目录，导致 MyGo 报 **`a link in the plugin: helper/node_modules/...`**（Electron 自带符号链接）。这不是让你执行 unlink，而是安装器的安全拒绝。

**0.2.1 把依赖放到了 `plugin-data/qishui/sdk-runtime/`，插件目录与安装 ZIP 只保留代码。** 本地目录和 ZIP 均用 MyGo 0.1.7 的实际安装器验证；代码更新不再清掉运行时依赖。请勿把旧版包含 `node_modules` 的目录重新导入。

## 登录与曲库的实际验证状态

旧版纯 HTTP 扫码路径（0.1.x，错误码 7）已移除，改为 **独立 Electron 会话 + 官方安全 SDK**。

已在 **macOS arm64、MyGo 0.1.7 的真实插件运行时**验证：

- 用户在新辅助窗口扫码后，私有会话取得登录凭据。
- 登录后独立请求验证用户资料；`signIn()` 返回真实账号，而非占位账号。
- 恢复该会话后，首页返回并映射 6 首推荐歌曲，搜索返回并映射 20 条结果。

用户已确认能够进入页面。**仍未验收**：下一次全新账号完整扫码、官方二次验证 UI 的真实完成、所有歌曲与音质的兼容性、歌词/歌单完整性。不能从登录成功推断所有音乐功能已可用。故障与验证边界详见 [调查记录](docs/login-investigation.md)。

## 安装

1. MyGo → Settings → Plugins → **+** → `DaviRain-Su/mygo-music-qishui`，或导入 [Releases](https://github.com/DaviRain-Su/mygo-music-qishui/releases) 中的 `plugin-qishui-0.3.0.zip`。
2. 安装 **Node.js 22.12+ 和 npm**。播放转换另需 ffmpeg；macOS 可使用 `brew install node ffmpeg`。
3. 在插件目录执行一次：

   ```sh
   cd "$HOME/Library/Application Support/MyGo Music/plugins/qishui"
   node helper/install.cjs
   ```

   **不要在插件目录执行 `npm install` 或 `npm ci`。** 上述命令会自己在独立数据目录安装固定版本 Electron、React 和二维码库；相同依赖已安装时直接复用。Electron 下载约数百 MB，但不进入插件安装包。源码开发或自定义 MyGo 数据目录可显式指定：

   ```sh
   node helper/install.cjs --data-dir "/你的路径/plugin-data/qishui/auth-sdk"
   ```

   首次认证从官方 CDN 下载固定版本安全 SDK，校验 SHA-256 后缓存。**没有在仓库中分发官方 SDK 或原生二进制。**

4. 在插件设置中允许启动程序（**Node.js → Electron**，播放另用 ffmpeg）。
5. 手动更新代码后，**⌘Q 完全退出 MyGo 再打开**。登录提示应显示 `[汽水 0.3.0 SDK]`。

当前仅验证 macOS arm64。读取曲库使用本机 `/Applications/汽水音乐.app/Contents/Resources/app.asar.unpacked/bdms.node` 官方原生 SDK；需要安装官方汽水客户端，但**不读取它已有的 Cookie、账号数据库或浏览器 profile**。其他平台、不同原生 SDK 版本仍需适配。

目录分工：

```text
plugins/qishui/                         # 可安装、可更新的代码，无 node_modules
plugin-data/qishui/sdk-runtime/<key>/   # npm/Electron 依赖，按锁定版本及平台复用
plugin-data/qishui/auth-sdk/            # 本插件的私有账号会话和安全 SDK 缓存
```

代码更新不会删除依赖或账号会话。只有依赖版本或平台改变、运行时损坏时，才需要重新执行安装命令。不要删除 `auth-sdk` 来解决安装报错。

## 登录

点击登录，在 MyGo 的二维码上用抖音 App 扫码，并在手机上确认。如服务端要求二次验证，会打开「MyGo · 汽水音乐官方安全验证」窗口，必须正常完成验证，不会自动跳过。

登录必须同时满足：**有有效会话 + 独立用户资料接口验证成功**。MyGo 在 `signIn()` 返回后关闭二维码弹窗并刷新/切换音源，不是另开一个成功网页。

Chromium 可能在服务端已经下发 Cookie 后，仍将确认响应报告为网络失败。插件在这种特定传输错误下会独立验证用户资料；验证不通过仍报错。**明确的服务端拒绝（如 7、2046）不能被旧 Cookie 覆盖成成功。**

## 隐私与权限

- 辅助程序只使用 `plugin-data/qishui/auth-sdk` 下本插件自己的身份和 Chromium 会话，目录仅本人可访问。
- Cookie 通过私有管道传递给插件存储，不出现在进程参数、URL、控制台日志中；不读取其他应用的登录数据。
- 浏览器窗口启用 sandbox、context isolation，禁用 Node 集成；不关闭 webSecurity。仅在私有会话里对固定官方 API 适配 CORS。
- Node 原生程序权限比 JS 沙箱更宽，应只安装可信来源的插件代码。此版本的启动命令名单没有通配符。
- 诊断 `[qishui] login:` 及 `playbackDiagnostic` 只含版本、阶段、错误码或文件大小等信息。**不要公开 `storage.json`、`auth-sdk` 目录或抓包中的凭据。**
- 退出登录会清理插件缓存及辅助程序自己的会话，不会退出官方汽水客户端。

## 测试 / 排错

无需构建插件入口：

```sh
node --experimental-vm-modules --test tests/login.test.mjs tests/helper-*.test.cjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_package.py
```

生成不含依赖的安装包：

```sh
python3 scripts/package.py
# 输出 .dist/plugin-qishui-0.3.0.zip
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

安装器回归（验证源码目录和最终 ZIP，不能用直接复制文件代替）：

```sh
cp tests/mygo-install-regression_test.go "$MYGO_SOURCE/internal/plugin/qishui_install_test.go"
QISHUI_PLUGIN_DIR="$PWD" QISHUI_PLUGIN_ZIP="$PWD/.dist/plugin-qishui-0.3.0.zip" \
  go -C "$MYGO_SOURCE" test ./internal/plugin -run TestQishuiInstallArtifacts -count=1 -v
```

这些自动化模拟测试不能代替真实账号验收。参考：[官方 YouTube 插件](https://github.com/egoist/mygo-music-youtube-music)、[Folia 汽水认证适配](https://github.com/2706521883-lgtm/folia-qishui)。
