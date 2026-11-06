# 汽水音乐（MyGo Music 插件）

[MyGo Music](https://github.com/egoist/mygo-music) 的实验性汽水音乐插件，需要 MyGo Music 0.1.7 或更新版本。

**状态：登录流程有自动化回归测试，但尚未完成真实账号的扫码成功验收。** 获取二维码、未扫码轮询正常，不代表已打通完整登录。搜索、推荐、歌单、喜欢、播放也仍需真实账号验证。

## 安装 / 更新

MyGo Music → Settings → Plugins → **+** → 输入 `DaviRain-Su/mygo-music-qishui`。

也可将 `plugin.json`、`index.js`、`locales/` 放到插件目录的 `qishui/` 下（Settings → Plugins → Show Plugins Folder）。

**手动替换文件后必须完全退出 MyGo Music 再打开**，仅关闭登录窗口不会重新加载 JS。0.1.1 的登录提示会显示 `[汽水 0.1.1]`，可据此确认实际运行的版本。

## 登录与已知限制

1. 点登录，用抖音 App 扫描二维码，并在手机上确认。
2. 插件区分「等待扫码」「已扫码，等待手机确认」「已确认，正在取得会话」。
3. **只有收到非空登录会话并保存后**，`signIn()` 才返回账号。MyGo 随后关闭二维码弹窗并切换/刷新汽水页面；不是再打开一个「登录成功」网页。
4. 接口拒绝、超时、无法识别的响应、确认后没有会话都会明确报错，不再一直显示二维码。

汽水可能要求额外安全验证（`error_code: 2046`）。**当前插件未接入官方安全验证窗口 / 签名运行时，遇到此情况不能完成登录。** 手机端确认不等于桌面已登录，也不能通过伪造成功状态跳过验证。

## 排错与隐私

遇到问题请提供登录弹窗中的错误文字及插件版本。脱敏诊断通过 `[qishui] login:` 打印，也保存在插件存储的 `loginDiagnostic` 字段中（版本、阶段、状态、错误码）。

诊断不记录 Cookie、二维码 token 或完整响应。**不要公开整个 `storage.json`**，它包含登录凭据。

## 播放依赖

需要 **ffmpeg**（macOS 可 `brew install ffmpeg`），并在 MyGo 插件设置中允许启动程序。插件尝试将汽水 AAC 流转成 MP3，以本地 HTTP 服务提供给 MyGo；音源解析及播放尚未完成真实账号验收。

## 开发与验证

无需构建，无 npm 依赖。Node.js 22+ 运行：

```sh
node --experimental-vm-modules --test tests/login.test.mjs
```

测试加载完整的 `index.js`，模拟汽水响应，覆盖成功返回账号、Cookie 传递、重定向、错误码、超时、隐私和旧版 MyGo 无 `host.t` 等情况。**模拟测试不等同于汽水真实账号的端到端成功验证。**

另外已在 MyGo 0.1.7 的原版插件运行时（moejs + fetch）配合本地 HTTP 模拟服务器验证登录成功/失败分支。复现方法（`MYGO_SOURCE` 指向 MyGo 0.1.7 的源码目录）：

```sh
cp tests/mygo-login-regression_test.go "$MYGO_SOURCE/internal/plugin/qishui_regression_test.go"
QISHUI_PLUGIN_SOURCE="$PWD/index.js" go -C "$MYGO_SOURCE" test ./internal/plugin -run TestQishuiLoginRegression -count=1 -v
```

此测试只使用本地模拟响应，不读取真实账号存储。

参考：[官方 YouTube Music 插件](https://github.com/egoist/mygo-music-youtube-music)、[folia-qishui](https://github.com/2706521883-lgtm/folia-qishui)。
