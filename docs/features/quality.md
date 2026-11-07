# 音质 helper 合同与 integration handoff

lossless 不再回退 AAC→MP3。只选择明确 codec_type=flac 且当前 quality_map.play_detail 显式授权的流；need_vip=true 仍要求 /me is_vip===true，need_purchase 必须 false，缺失/未知拒绝。未添加端点、会员推断或购买证明。standard/high 继续使用原 AAC→128/192kbps MP3 路径。

## 导出与接入

- audio.cjs 保留 MAX_AUDIO_BYTES、playbackKey、decryptAudio、selectAudio、audioURL；新增 `losslessAudio(Buffer, key=null): Buffer`。原生 FLAC 保留完整输入；非分片 MP4 通过唯一音频 stsd 的 fLaC（或 enca + sinf/frma=fLaC）与结构化 dfLa 提取原始 metadata 和实际 sample bytes。不扫描任意字符串、不从 mdat 顺序猜位置。
- playback.cjs 保留 Playback、downloadAudio、transcode。`transcode(input, output, bitRate, signal, format='mp3')` 增加可选第五参数 flac；FLAC 输入先验证结构并读取原始 STREAMINFO 样本数，再由 ffmpeg stream copy 输出；输出必须通过严格解码（xerror、crccheck+explode），且解码 PCM 字节数与原始样本数×声道数×4 完全相符后才能缓存。绝不将 AAC 编码为 FLAC。
- `Playback.prepare({id,quality:'lossless'})` 返回 `{url,type:'flac',size,quality:'lossless'}`，不编造 bitRate；缓存键为 id:quality:format，与 high MP3 独立。
- 没有新增协议错误类型。格式证据不足使用现有 audio（明确不支持）错误，权益使用 entitlement，输出失败 ffmpeg。integration 应允许本地 `.flac` 和 MyGo type=flac，更新仅描述 AAC/libmp3lame 的 ffmpeg 文案；本任务未修改 index/protocol/runtime/main。

## 限制

仅非分片、单音轨、单 sample description、version-0 audio entry，FLAC STREAMINFO 必须为首块且34字节，metadata 链必须完整。MP4 保留 dfLa 解码信息与 sample 边界。CENC 仅 cenc AES-CTR、8/16字节逐样本 IV、无 subsample flags；不支持 fragmented、ALAC、Hi-Res/空间档位、其他加密模式、未知权益映射。不会绕过试听检查。原始 FLAC 检查 metadata 结构，实际帧有效性由 ffmpeg 严格解码检查；同时对照原始样本数检测完整帧边界截断。STREAMINFO 样本总数为0（未知）明确拒绝，未自行实现完整 FLAC 解码器。

输入最大64MiB、200000样本、box/metadata数量有界。严格解码使用 s32le 流式计数并丢弃 PCM，不写 PCM 文件；预期解码量最多512MiB，超过预期立即终止进程。验证与下载/转码共用25秒 abort，验证进程收到 abort 后 SIGKILL。输出 ffmpeg -fs 限制64MiB，达到上限拒绝以避免返回截断文件。保留25秒 abort、最多2个进行中任务、3个缓存、5分钟TTL、0600/0700权限、密钥内存归零及失败/close清理。注入的 api/fetcher/encoder 必须遵守 AbortSignal；不能强制终止忽略 signal 的自定义 Promise。

## 离线验证

`node --test tests/helper-audio.test.cjs tests/helper-playback.test.cjs`

TDD：先观察 lossless AAC 回退及缺少 losslessAudio 的失败，再观察真实本地合成 MP4-FLAC 仍输出 MP3 的失败，随后实现。固定假密钥测试 CENC FLAC 样本保留、dfLa/frma/schm/senc、重叠/越界和数量异常；权益 unknown/VIP/purchase 保守拒绝。本地 ffmpeg 生成0.2秒合成音频，FLAC→MP4→提取→PCM逐字节相同，输出 FLAC 魔数与独立 cache/type/extension 验证通过。失败与 abort 清理、下载大小/重定向限制有覆盖。本轮回归先复现截断文件被成功缓存的失败，再验证真实2秒合成 FLAC 的帧中截断、完整帧边界截断及帧损坏均拒绝、缓存为空且临时/输出文件清理；未知样本数和解码量超限也拒绝。聚焦测试共19项通过。

未访问网络、账号、真实媒体；未验证线上 FLAC 返回形态、真实授权 FLAC、桌面播放、根桥接集成。测试需要本地支持 FLAC/MP4 的 ffmpeg；每次 fixture 子进程4秒上限，合成测试15秒上限，abort测试3秒上限。未耗时等待真实25秒超时或制造64MiB输出；对应控制路径通过 abort/大小边界断言覆盖。

## 交付状态

原实现 `54d5364` 的独立审查发现截断 FLAC 可误判成功。修复提交 `e84a40a` 已通过全新独立复审，19/19聚焦测试通过，并已合并到主分支。历史阻塞已关闭；宿主集成和线上授权无损验收仍单独跟踪。

集成仍须更新 index 的本地扩展名/type 验证及返回值以接受 FLAC，并通过真实 host bridge 测试；更新 ffmpeg 错误文案。未修改 index/runtime/main/protocol 或其他模块，也未宣称桌面无损播放已可用。当前测试未证明真实运行中的 ffmpeg 在25秒截止时被终止，仍需集成验证该进程截止路径。
