# 汽水 SDK 认证辅助程序：规格与验收

## Phase 0/1：需求依据与范围

这是既有个人插件的缺陷修复，不是商业产品立项；需求和用户验证引用 `../login-investigation.md` 及用户多次真实扫码失败、明确要求继续修复的反馈。不声称已有付费验证。

目标：不用残缺的纯 fetch 模拟官方认证；用隔离的 Electron 会话运行官方浏览器安全 SDK，保留官方二次验证。登录成功必须取得会话并能读取当前用户资料。不得读取官方汽水客户端或系统浏览器已有 Cookie，不得关闭/跳过安全验证，不得把模拟通过宣传成真实成功。

本阶段优先 macOS arm64（当前实际环境）。其他平台不具备可验证的运行时/本地 SDK 时必须明确报 setup，而不是声称跨平台可用。搜索/播放协议正确性另行验收。

## Phase 2：架构

MyGo JS 插件 → 受进程权限控制的 Node launcher → 独立 Electron helper → 官方 Passport / 安全 SDK。

- helper 运行于本插件 `host.dataDir/auth-sdk`，独立身份与浏览器存储，不共享官方客户端的 profile。
- MyGo 与 helper 通过 stdin/stdout JSON Lines 通信，不在 URL、进程参数或日志中传输 Cookie。
- 浏览器 renderer 无 Node 集成、有 sandbox 与 context isolation；安全 SDK 只从固定官方 URL下载，固定版本和内容摘要验证后在本地缓存，不将第三方 SDK 文件加入仓库。
- 静态页使用本 helper 私有会话的 `app://resources/auth/` 协议，只服务固定资源表；不监听 HTTP 端口，不提供通用代理、文件读取或 eval RPC。该稳定本地 origin 便于 SDK 保持自己的 localStorage；私有会话内仅对固定官方 API 调整 CORS，webSecurity 保持启用。
- SDK 请求使用浏览器会话的 Cookie；观测实际请求是否含 SDK 生成的动态安全参数，不自己伪造签名。
- 官方二次验证在独立、有明确标题的窗口进行；取消、超时必须结束本次登录。
- 如读取资料需原生签名，只可按用户安装的官方客户端路径使用其本地 SDK，不分发该二进制、不读取其用户数据。无法验证接口时明确报告，不把 HTTP 200/空响应算作成功。

## Phase 3：接口与状态

协议版本 1；每行 UTF-8 JSON，最大请求 64 KiB。请求 `{id:正整数,op:string,params:object}`。

允许操作：`hello`、`signIn`、`account`、`signOut`、`request`、`probe`（无凭据输出的 SDK 自检）、`shutdown`。不接受任意命令、任意外部 URL 或 JavaScript。

响应：`{id,ok:true,result}` 或 `{id,ok:false,error:{code,message}}`；异步登录进度为 `{id,event:"prompt",qr?:string,text:string}`。

`signIn` 结果 `{cookie:string,account:{id:string,name:string,imageUrl?:string}}`。Cookie 仅由私有管道返回给插件存储；认证成功以前禁止返回账号。`account` 未登录时返回 null。

`request` 只允许固定汽水 API 主机下 `/luna/pc/` 路径，方法 GET/POST，参数和请求体受大小限制；不接受调用方传入 Cookie、签名或 Host。helper 统一使用其身份、会话与 SDK。

状态机：starting → sdk-ready → waiting-scan → scanned → confirmed → [verification] → verifying-account → authenticated；任何一步 → failed/cancelled。验证 SDK 未真正初始化、服务端非零错误、没有会话、资料接口无法验证、窗口关闭、管道断开、总时限到达都不是成功。

时限：SDK 初始化 30 秒，单次 API 20 秒，登录总时限 240 秒，轮询间隔 2 秒。SDK 初始化合并；同一登录内请求串行，最多一个登录，禁止并行覆盖二维码；签名观测用独立 biz_trace_id 关联，避免 SDK 自身后台请求覆盖观测。请求错误不能被吞掉无限重试。

账号/登录资料不作为日志；诊断仅含阶段、协议/SDK版本、API错误码、HTTP状态、签名是否存在等布尔值。不能输出完整 URL 查询、SDK token、Cookie、完整响应或用户标识。

## Phase 4：任务

1. 验证官方 SDK 可在干净 Electron 会话启动并生成真实动态安全参数；未通过不能替换用户插件。
2. 实现 JSONL 协议、域名/路径限制、生命周期、私有数据目录和依赖安装指引。
3. 实现 SDK 认证、可见二次验证、会话与用户资料验证。
4. 插件接入 helper：明确进程权限、运行时缺失错误、进度转发和退出清理；移除默认纯 fetch 登录路径。
5. 运行离线与真实运行时测试；最终一次受控扫码验收，未成功则保留明确的未完成状态。

## Phase 5：测试规格（实现前）

- Happy：真实 helper 握手；SDK ready；服务端二维码与签名观测；模拟 confirmed + session + 用户资料；事件转发；重启恢复自己的会话。
- Boundary：空会话、资料为空、最后一个重定向、大小刚好等于上限、同一登录重复调用、取消发生在确认后、helper 重启、SDK 缓存损坏、未知协议版本、没有已安装官方本地 SDK。
- Error/Attack：任意外部 URL、路径逃逸、注入命令/JS、恶意 id/op/超长行、HTTP 200 非 JSON、错误7/2046、签名没有生成、SDK下载摘要不匹配、关闭验证窗口、stdin EOF、helper 异常退出、等待超时。
- 隐私：断言日志/错误不包含测试 Cookie、token、手机号或原始响应；原生 SDK 路径不能被请求方覆盖；不改动其他应用 profile。
- 真实验收：手机确认后，helper 取得会话并读到当前用户资料，插件 signIn 返回账号，MyGo 关闭弹窗并进入个人页面。未扫码 `new` 和所有模拟测试均不能代替此项。

## Phase 6/7：实施与复核记录

- 官方 SDK 下载内容与参考版本匹配，摘要已锁定；资源只缓存在私有目录。
- 真实未扫码探针：SDK ready、签名存在、服务端 token 存在、status=new。
- 受控用户扫码：已下发会话，但 renderer 报传输错误。独立账号资料验证成功；已增加仅针对 transport network 错误的严格验证收尾，不覆盖明确拒绝。
- MyGo 0.1.7 真实运行时 + 本次私有会话：SignIn 成功返回真实账号，Home 映射6条、Search映射20条。
- 已修正推荐使用 POST，以及 root result_groups / items / track_wrapper 的字段映射和毫秒时长。
- 模拟覆盖旧 Cookie 不当成功、错误7/2046、取消、过期、helper EOF/超时、版本不匹配、路径逃逸、SDK摘要/大小、CSRF以SDK处理为准、账号独立验证。
- 仍未验收的范围：用户当前桌面窗口实际切页、新账号新一轮扫码、真实二次验证UI完成、播放和完整歌单功能。发布说明必须保留这些限制。
