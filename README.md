# 汽水音乐（MyGo Music 插件）

在 [MyGo Music](https://github.com/egoist/mygo-music) 里听汽水音乐。

## 安装

1. MyGo Music → Settings → Plugins → **+** → 填入本仓库地址
2. 或手动：把本目录复制到 MyGo 的插件目录（Settings → Plugins → Show Plugins Folder）

## 登录

插件页面点登录后，会弹出二维码 —— 用**抖音 App** 扫码确认即可（无需汽水会员账号体系，抖音账号通用）。

## 功能

- 扫码登录（抖音账号）
- 搜索歌曲
- 播放（ffmpeg 转码 AAC → MP3）
- 首页推荐、歌单、喜欢的歌曲

## 依赖

- **ffmpeg**：播放需要（`brew install ffmpeg`）。插件用它把汽水的 AAC 流转成 MP3 并本地伺服，与官方 YouTube Music 插件同一种做法。

## 协议说明

- 登录走 `passport` 接口（`/passport/web/get_qrcode/` + `/passport/web/check_qrconnect/`），扫码确认后拿 session cookie。
- 数据接口走 `luna`（`/luna/pc/search/track` 等），带登录 cookie。
- 音频流是 MP4 容器里的 AAC，插件的 `stream()` 经 ffmpeg 转成 MP3 后交给 app。
