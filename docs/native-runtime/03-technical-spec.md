# 技术合同

已有接口、超时、JSONL 和音频合同复用固定上游源码及其测试。本地差异如下。

保留现有 discover/charts/history 导航：发现与榜单沿用旧版 `/luna/pc/discover` 空请求体的混合内容合同，使用新 Catalog 的签名与 DTO mapper；最多 5000 个节点，非法数组报 response。真实混合响应超过 1 MiB，因此 discover 与原有 history 共用 8 MiB 响应上限，其余接口保持 1 MiB。历史复用新 Catalog.recent()。首页恢复个性推荐主卡；保留 liked/savedAlbums/stations 的宿主导航。

## 推荐与封面

- `Catalog.home()` 返回 `Browse`：第一节真实推荐 tracks（最多 12 首，title/PageTitle 为「为你推荐」）；第二节为 recommendations/familiar/fresh 持续电台；第三节为情景模式（总预览最多 8 个模式，更多指向 listening-modes）；最后为最多 6 个真实探索资源，保持 radio/playlist 类型。
- `homePage({tracks, stations, discoveries})` 是纯展示映射；空推荐保留可点击持续推荐入口，无虚构歌曲；推荐失败仍报错，次要探索/模式读取网络失败不掩盖推荐，认证、验证或取消失败继续传播。
- `Catalog.modeStations(modes, {limit=64})` 复制原始模式，删除 Logo imageUrl，按各自 id 请求 `recommendationBatch({id})`，取首个有效 album.imageUrl。不得使用其他模式的封面代替；缺封面使用宿主缺省图，不回退到 Logo。
- 封面并发不超过 6、一次最多 64 个模式；缓存 Map 最多 128 项，成功 10 分钟、无图/网络失败 30 秒。缓存归当前账号 state；过期重新预览。浏览不触及 feedStates 或 feed-first-use，不下载音频、不调用 played，played_media 固定空。
- 听歌模式首项 recommendations；原始分组和精确 scene/preference id 保留。站点列表统一使用音乐封面。
- 导航顺序：首页、为你推荐、听歌模式、发现、榜单、个人曲库。

特殊情况：空歌曲列表、空发现、模式接口网络失败、封面无图、封面网络失败、验证/过期、退出期间迟到、未知未来模式、缓存过期、缓存超限、大 int64 scene id、多个页面重复浏览分别覆盖；所有浏览仍不影响首次持续播放的计数与反馈。

## 存储

- 旧字段：`authBackend: "sdk-v1"`、`cookie: string`；旧 `account` 不作为认证结果。
- `session`: `{version: 1, deviceID: string[16 digits], installID: string[15 digits], cookies: Cookie[], account: Account}`。
- `Cookie`: `{name: ASCII token, value: ASCII cookie-octet}`；缺失 domain/path 时仅用于 `api.qishui.com/`，沿用上游限定。
- `native-migration-v1: 1`：迁移已处理或用户已退出。旧字段及磁盘目录保持原样。
- Cookie header 上限 16384 字节，最多 128 项；禁止控制字符、重复名称及空值，必须包含上游支持的会话名称。匿名设备身份由上游身份生成器生成。

## 接口和状态

`legacySession(storage, identityFactory): Session | null`：同步、无 HTTP/写入/进程。仅 backend 匹配且无迁移标记时解析 Cookie；无效输入返回 null。

`account(): Promise<Account | null>`：优先新 session，否则取旧候选；调用 HTTPS `/luna/pc/me` 验证。成功写入新 session 和迁移标记；明确会话失效返回 null、标记已处理，新会话过期也不得回退到旧账号；网络错误不标记，可重试。验证前无 session 写入。

`signOut(): Promise<void>`：递增 generation，移除新 session，写迁移标记，取消并关闭所有工作。迟到验证不得写回。新扫码成功也写标记。标记只在已完成动作后写，不改变旧账户磁盘数据。

`npm run build`：生成根 `index.js` 并编译、核验完整原生组件到根 `bin/`、`runtime/native/`，使构建后的源码文件夹可直接导入。`npm run check` 只核对生成入口，不下载或编译组件。原生输出不提交 Git。

`npm run package [-- --output PATH]`：仅 macOS arm64；从固定官方归档准备资产、逐文件校验、编译、签名核验、写来源记录、白名单收集及 ZIP，同时把同一组完整原生输出写入源码根目录。默认输出 `.dist/plugin-qishui-${version}-darwin-arm64.zip`，若已存在则拒绝覆盖。所有可执行文件保留 0755；禁止链接、特殊文件、Node/FFmpeg 可执行文件、旧 helper、测试及个人数据。

`python3 scripts/package.py [--source PATH] [--output PATH]`：对原生 manifest 委托同一 Node 打包入口，不再生成仅含 JS 的坏包；旧版非原生 manifest 保留历史代码包行为。构建工具只在开发机使用。

缺少原生可执行文件（ENOENT）时，启动错误明确说明缺少组件并要求导入完整安装包；权限类错误继续使用权限提示，不把它们混为一类。

## 边界

1. 无账号：返回 null。
2. 旧 backend 不匹配：忽略。
3. Cookie 超长、超过 128 项：忽略。
4. 无会话 Cookie：忽略。
5. CR/LF、非法名称或值：忽略。
6. 重复 Cookie 名称：忽略。
7. 已有新 session：不读旧会话。
8. 过期旧会话：不再复活。
9. 暂时网络失败：原数据保留，可重试。
10. 验证期间退出/换号：迟到响应不得覆盖。
11. 退出后重载：标记阻止重新迁移。
12. 官方资产哈希不匹配：构建失败，不执行资产。
13. 不支持平台：构建失败。
14. 音频不支持、预览或无权益：沿用上游错误，不降级绕过。
15. 从构建后的源码文件夹导入：保留 bin/runtime 及执行权限，实际签名成功。
16. 旧 Python 打包入口：原生版本必须生成完整包。
