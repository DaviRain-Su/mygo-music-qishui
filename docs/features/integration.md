# 0.4.0 集成 handoff

本任务只修改 integration-001 允许路径；Catalog、Community、Actions、audio 和
playback 已合并实现保持原样。没有新增猜测 API 路径，没有读取账号文件、联网、
执行真实账号写入、推送、发布或修改已安装插件。README 中既有实测属于历史证据。

## 接口

`index.js` → JSONL `{id,op:"catalog",params:{method,args}}` →
`Runtime.catalog` → `Features.dispatch` → 真实 Catalog / Community / Actions。
`helper/main.cjs` 仅转发；`helper/features.cjs` 用固定 Map 中的显式闭包派发，
不使用用户输入作为对象属性名。不开放 constructor、__proto__、clear、invalidate
或模块内部 collection 等方法。非法方法/args 在账号查询之前拒绝。

- Catalog：home、browse、search、playlists、playlist、liked、isLiked、savedAlbums、
  recent、stations、stationNext。
- Community：lyrics、comments、postComment。
- Actions：like、savePlaylist、saveAlbum、createPlaylist、addToPlaylist、played。
- MyGo `addToPlaylist({id,trackIds})` 转为模块 `{playlistId,ids}`。
  createPlaylist 只有模块确认真实 id 才补 `mine:true`；不伪造创建结果。
- `played({id})` 仅由宿主回调调用；stream 和预加载均不触发历史写入。
- 导航包含首页、发现、榜单、喜欢、历史、电台、收藏专辑。歌单由宿主既有入口使用。
  browse 仍仅接受 Catalog 已支持的页面命名空间，不解释 URL。
- 不导出 suggest、album/artist 详情、followArtist、rename/delete/remove/reorder、
  likeComment、shows/remote 等未具备可靠路径的能力。

## 生命周期与错误

每次 Features 调用从进入服务开始共用 25 秒 AbortController，包括账号查询、
Catalog 排队与所有分页；index 的 catalog RPC 等待为 28 秒。AsyncLocalStorage
让 Runtime.api 的账号 `/me` 与后续请求使用同一个 AbortSignal。功能账号查询
只使用现有 `/me`，不走认证恢复的 Passport fallback。

服务层在每次 await 前后检查取消，并对忽略 signal 的底层 Promise 竞速取消；
迟到响应不能返回给模块继续刷新缓存。登录开始、登出、取消/关闭均 reset；
账号 id 变化取消其他在途操作，替换模块实例。登出清理期间拒绝新功能请求。Catalog 自身的 clear 也会取消队列。
超时清理该调用所持实例的缓存；因此并发读可能需重新发起。缓存只存在 helper 内存。

Actions 的失效回调保守清理 Catalog，包括不确定写入；Community 发评论自行清理
对应评论缓存。写入中断后等待真实 Actions 错误包装，以保留 preceding `confirmed`
计数。未开始传输时的账号取消仍是 account/timeout；开始写入后结果无法确定则为
mutation-unknown，不自动重试。helper EOF、崩溃和 28 秒桥超时也以 unknown 返回
在途写入，但不能恢复未收到的 confirmed，因而省略它，绝不编造零或成功。

protocol 与 index 均采用固定中文文案，不转发原始错误文本/URL/凭据。
新增 input、limit、pagination、mutation-unknown、cache；api/unknown/cache 允许
0–100 的安全整数 confirmed，并在文案中显示。未知结果和缓存失效文案不建议重试。

## 音频与打包

stream 仅接受私有 `auth-sdk/audio-cache/run-*/32位随机十六进制名.mp3|flac` 的
本地文件，扩展名必须与 result.type 相同。返回实际 type、quality、bitRate；
FLAC 不编造 bitrate，high MP3 不改标 lossless。原权益与容器证据校验保持不变。

plugin、helper package/lock 自身版本、hello 和入口版本统一为 0.4.0；依赖不变。
代码包新增 docs/features 文档目录和 features.cjs，仍排除 node_modules、SDK 二进制、
账号目录与符号链接。未创建 Release。

## 离线验证

先新增真实模块桥接测试，观察缺少 features.cjs 的失败，再实现。
Node 测试使用合成底层 API 响应，不以 DTO 代替功能实现。覆盖全部 20 个方法、
四类搜索、参数适配、状态失效、账号变化、登录/登出/取消、迟到返回、恶意方法名、
25 秒共享预算（账号、队列、多页）、部分追加、固定安全错误与计数、FLAC/MP3 一致性。
Runtime 测试加载实际类但不启动 Electron，不读取存储；只注入合成平台/传输边界。

真实 MyGo v0.1.7 moejs/host.spawn 的 Node 子进程加载实际 Features/模块，
底层 API 为合成响应，验证 exports/DTO/动作适配与 FLAC 返回。
Playback 的真实 ffmpeg 进程用本地 FIFO 阻塞输入，推进 mock timer 至 25 秒，
确认 SIGKILL、无缓存、临时文件清理；这不是实际媒体或网络测试。

本轮全量 Node：147/147 通过；Python 打包测试：3/3 通过；MyGo v0.1.7
真实 host 回归四场景、目录/ZIP 两种安装均通过；源码语法与 git diff --check 通过。

命令：

```sh
node --experimental-vm-modules --test tests/login.test.mjs tests/helper-*.test.cjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_package.py
python3 scripts/package.py --output /tmp/plugin-qishui-0.4.0.zip
```

宿主测试通过临时 Go overlay 加载仓库中的两份 Go 回归，排除既有 live 测试，
GOPROXY=off/GOSUMDB=off、使用已缓存 Go 1.27.3 工具链和临时 GOCACHE。
只运行 TestQishuiLoginRegression 和 TestQishuiInstallArtifacts；安装目标为临时目录。
默认 Go 自动工具链校验和缓存路径曾受离线/写权限限制，改用已有工具链和允许写入
的临时构建缓存；没有下载依赖或扩大沙箱权限。

## 剩余义务

- 独立只读线上验收：分页完整性、发现/榜单、情景电台 payload 与真实响应兼容性。
- 真实授权 FLAC 源、设备播放与桌面实际出声验收；离线容器/桥接通过不等于线上可用。
- 创建、追加、收藏、评论等真实写入必须另获明确授权，当前只有合成传输验证。
- 未支持 API、Hi-Res/空间音频和官方 UI 专属能力仍 blocked，不宣称原生 App 完整对齐。
- 独立集成审查、合并、发布由 orchestrator 后续处理。
