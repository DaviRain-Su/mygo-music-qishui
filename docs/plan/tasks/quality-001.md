---
id: quality-001
scope: helper/audio-and-playback
status: ready
depends-on: []
---

## objective

修正 lossless 被静默输出MP3的契约，并在不突破权益的前提下实现真实MP4-FLAC/FLAC无损处理。只对真实FLAC源输出FLAC；若缺少足够格式证据则明确拒绝无损而不是伪装，报告限制。

## context

- docs/features/README.md 音质模块合同
- docs/auth-sdk/05-playback-fix.md
- helper/audio.cjs 与 helper/playback.cjs
- /tmp/qishui-auth-reference/electron/qishui/qishui-audio-decryptor/track-decryptor.js 与 decrypt-utils.js（协议参考，不复制文件）
- /tmp/folia/qishui-api.js membership/quality helpers

## path

- helper/audio.cjs
- helper/playback.cjs
- tests/helper-audio.test.cjs
- tests/helper-playback.test.cjs
- docs/features/quality.md

不要改 index/protocol/runtime/main；需要新增helper错误类型或file extension验证时在handoff明确说明，供integration任务接入。

## verification

必须TDD。覆盖source AAC请求lossless不伪装、FLAC真实样本保留、MP4 stsd dfLa/enca原始格式、sample边界/CENC错误、权限映射need_vip/need_purchase/unknown、lossless独立cachekey/扩展名/type、ffmpeg输出FLAC魔数、体积/超时/清理。允许本地ffmpeg生成的合成音频测试，不读账号/网络/真实媒体。提交仅本task路径。不要削弱existing entitlement或处理限制为通过测试。
