# 汽水功能对齐：0.4 设计合同

当前可安装集成版本：**0.4.2**（首页多板块；电台卡片优先用首曲封面而非情景 logo）。
- MyGo 首页会把「第一节 tracks」做成大卡片，后面如果没有歌单/电台/榜单 section，页面就会只剩一块很空。home 需组合：每日推荐 tracks + 情景电台 + 精选歌单 + 热歌榜 + 探索 links。
- `/feed/mode` 的 `url_info` 是官方情景 **logo/PNG 图标**，不是专辑图；电台卡片应再请求一页 `feed/song-tab` 取首曲 `album.imageUrl`（不写入播放用 feed 会话）。
只读线上验收已覆盖首页、发现、榜单、电台、搜索翻页、喜欢/历史/收藏专辑、歌词与评论翻页。
仍 blocked：专辑/艺人完整详情、suggest、关注艺人、歌单重命名/删除/移除/重排、评论点赞、Hi-Res/空间音频。
写操作仅有离线契约验证，需用户主动触发后再确认；桌面出声与授权无损亦需本地确认。

## 需求依据 / Phase 0–2

个人项目修复与扩展：用户明确要求补齐当前插件相对官方 App 的缺口，参考已有登录/安装/播放规格，不虚构商业付费验证。比较基线是本地官方 PC 3.5.1 资源和 MyGo 0.1.7/0.1.9 Source 接口，不宣称已审计所有未来版本或手机专属能力。

用户目标是登录后可浏览曲库并操作个人资料，而不是在 MyGo 里嵌入官方完整 UI。MyGo 支持歌曲/专辑/艺人/歌单、分页搜索、喜欢、收藏、历史、歌词、评论、station 和 browse；不支持视频/直播、完整社交回复树、会员支付、隐私/设备管理、官方 DSP/空间音效和独立 Hi-Res 档位。后者列为宿主/服务边界，不虚构按钮或绕过付费限制。

本轮通过三类模块平行实现、再由独立集成任务接入：

```
MyGo exports (index.js)
    └─ JSONL op=catalog { method, args }
        └─ helper dispatcher
            ├─ Catalog (read DTOs, cursor caches, discovery/feed)
            ├─ Actions (explicit user-triggered server writes)
            └─ Lyrics/comments (bounded parsing/read/write)
Playback helper (independent): true source FLAC → lossless FLAC; AAC → MP3
```

所有模块只有注入的 `api(path, query, body?)`，不读账号存储、不自己做签名/网络；集成层提供当前账号的 Runtime.api。状态在当前 helper 生命周期内；signOut/account change 清理所有缓存。新增写操作仅在用户主动操作时发出，不在自动化或探测中对真实账号点赞、发评论、删改歌单。

## 接口证据（Phase 3）

### 当前账号只读验证通过的 PC 路径

- GET `/luna/pc/search/track`, `/search/album`, `/search/artist`, `/search/playlist`：query `q,cursor,search_method`；根 `result_groups`，按 group.id 精确取 `tracks/albums/artists/playlists`，`data[].entity.<kind>`。不要向 track 路径加 search_type 冒充分类搜索（已实测仍只返回 tracks）。
- GET `/luna/pc/user/playlist`：`user_id,cursor,count`；根 `playlists`、`total_num`。卡片 `id,title,public_title,url_cover,count_tracks,owner.id/ nickname,type`。
- GET `/luna/pc/me/collection/mixed`：`cursor,count`；根 `mixed_collections[]`，item_type 区分 album/playlist/track，根 total_num。不能把混合收藏一概映射为喜欢歌曲。
- GET `/luna/pc/me/recently-played-media`：`cursor,count,media_type,scene`；根 `media[].entity.track`、`next_cursor,has_more,total_num`。
- POST `/luna/pc/feed/mode` body `{}`：`feed_mode_block[].feed_mode[]` 和 `feed_mode_bar.feed_mode`。情景模式 `entity.feed_scene_mode.scene_mode_id`，偏好模式 familiar/fresh。
- POST `/luna/pc/feed/song-tab`：已有验证，body `is_first_request,played_media,is_did_first_request,feed_counts`，可按已知合同传 feed_preference。
- POST `/luna/pc/discover` body `{}`：根 blocks[].inner_block[].resources，实际包含 discover_feed_playlist（10个歌单块）与 discover_top_song_list（3个榜单块），ranked_track.track是榜单歌曲。额外传 `pc_new_discover_request:true` 会只返回新歌单混排块，不能用于榜单页面；`/discover/view` 已实测404，不使用。
- GET `/luna/pc/comments`：`group_id,group_type:0,cursor,count`；根 comments（id,content,count_digged,time_created,user.nickname/medium_avatar_url），count:string、cursor:string、has_more:boolean。
- POST `/luna/pc/track_v2`：既有真实播放元数据包含 `lyric.content`, `lyric.translations.cn`, `lyric.type`；不另猜歌词端点。

### 参考源码支持，但未对真实账号执行写操作

仅允许这些路径和 payload，不自动重试：
- like on/off：POST `/luna/pc/me/collection/media` 或 `/media/delete`，body `{media:[{type:'track',id}],scene:''}`。
- savePlaylist on/off：POST `/luna/pc/me/collection/playlist` 或 `/playlist/delete`，`{playlist_ids:[id]}`。
- saveAlbum on/off：POST `/luna/pc/me/collection/album` 或 `/album/delete`，`{album_ids:[id]}`。
- createPlaylist：POST `/luna/pc/me/playlist`，`{name}`，必须从真实响应得到非空id，不得返回虚构创建结果。
- addToPlaylist：POST `/luna/pc/me/playlist/media/append`，`{playlist_id,media:[{id,type:'track'}]}`；参考只证明单曲请求，多曲逐曲且禁止盲目重试，失败报告部分完成/结果未知。
- played：POST `/luna/pc/me/recently-played-media`，`{media:[{type:'track',id}]}`；只能由 MyGo 真正的 played 回调触发，不在 stream/预加载触发。
- postComment：POST `/luna/pc/comments/create`，`{group_id,text,group_type:0}`；要求响应真实 comment id；缺 id 明确报错且不自动重发。

写入成功由 Runtime.api 的真实 API 状态判定；Actions 必须再检查有效响应对象、创建结果与数据 shape。网络超时可能已写入，必须提示结果未知，不伪装失败回滚。修改后失效相关读取缓存，失败也不能保留旧收藏缓存当成准确状态。

### 当前不具备可靠 PC HTTP 路径的功能

官方 UI 中可见：GetAlbumDetail、GetArtistDetail、ListArtistAlbums/Tracks、Sug、UpdatePlaylistInfo、MDeletePlaylists、DeletePlaylistMedia、CommentAction、CollectType.artist/user。但函数名不等于 URL。

本轮只读试验中 `/luna/pc/album/detail`, `/artist/detail`, `/artist/tracks`, `/artist/albums`, `/album`, `/artist`（及去掉pc/加末尾斜线的有限变体）均404；`/search/sug`、`/search/suggest` GET 返回1000004，不能称建议功能可用。不得把这些猜测路径做成产品功能，不得猜 destructive POST 来试验。

因此专辑/艺人完整详情、关注艺人、歌单重命名/删除/移除/重排、评论点赞、搜索建议保留明确 blocked 状态，不能用搜索部分结果冒充完整详情。分类搜索仍可展示真实卡片，不导出无法兑现的详情操作。

## Catalog 模块合同

`helper/catalog.cjs` 导出 `Catalog` 与可复用纯映射函数（或独立 `catalog-data.cjs`）。`new Catalog({api, account, now?})`；account 为 async 回调返回已验证 `{id,name,...}`。方法：`home`, `browse({page})`, `search({query,kind,offset})`, `playlists`, `playlist({id})`, `liked({offset})`, `isLiked({ids})`, `savedAlbums({offset})`, `recent`, `stations`, `stationNext({id})`, `invalidate(scope?)`, `clear`。

- 必须验证字符串ID、offset非负安全整数、输入上限；禁止任意URL或请求路径输入。
- DTO 严格采用 MyGo music.go 字段，duration/评论/歌词均毫秒，cover进入album.imageUrl，不使用虚构ID。
- 汽水封面/电台图标不是完整可下载URL：`url_cover`/`url_info`/`cover_url` 常见形态为 `{urls:['https://p*-luna.douyinpic.com/img/'], uri, template_prefix}`。只拼 `urls[0]+uri` 会HTTP 400。必须补CDN变换后缀：有合法 `template_prefix` 时用 `~{template_prefix}-resize:400:400.webp`（情景电台PNG实测只有这种可通）；否则用 `~c5_400x400.jpg`。已是 `https?://` 字符串且自带`~`的不重复追加。评论头像urls通常已是完整jpeg，不走此规则。
- 搜索每种类型使用独立路径和独立 query/kind 的 offset→opaque cursor 缓存，不能把offset直接当游标。PC JSON已观察到protobuf默认值省略：只有has_more===true才续页；false或缺失都结束，不能用残留cursor或total推导更多。非boolean的has_more仍报错；在more=true时缺游标、重复/循环游标、空页带更多必须报错，不能无限重复第一页。
- offset从0开始；未知offset可有限顺序回填，最多8页/一次调用、总时间/数据量有限，超出报 pagination 而不是返回假空页。
- `playlists()` 合并自己与收藏歌单，去重时自己拥有优先；mine 只能由 owner.id 与 account.id 或可信created来源证明。
- 喜欢歌单优先 playlist.type===1，名称匹配仅作为参考兼容路径，必须限制明确中文「我喜欢」/英文Liked，不能把任意收藏列表当喜欢；GET `/luna/pc/playlist/detail` query `playlist_id,cursor,count` 按media数组、has_more/next_cursor读取。喜欢歌单不存在不能判全空。
- `playlist()` 宿主无分页，有限遍历最多50页/5000首、总25秒预算；到达上限仍more时抛明确不完整错误，而不是谎称已读完。
- `isLiked(ids)` 只有在完整喜欢集合已获得时才能将不存在的id判false；不完整则报错，不输出全false。可短TTL缓存完整集合并在like后失效。
- 实际PC响应在终页省略has_more=false：喜欢歌单终页仍留next_cursor，再请求会得到playlist元信息但省略media_resources；历史终页省略has_more/next_cursor，返回总条数可少于total_num。以显式has_more=true为唯一续页条件，total_num仅作展示，不用于判定是否续页。必需身份/成功元信息缺失仍报错；已知列表字段缺失只在明确终页语义且有相应metadata（playlist.id匹配，或status_info有效）时允许表示空列表，不将任意{}当空结果。
- `savedAlbums` 仅从明确 album 类型收藏映射，不混入歌曲或歌单。
- `browse` 支持 discover/charts/history/library/推荐续页 等命名空间，页面字符串内部路由，不能解析为任意上游URL。已映射但不支持的卡片种类跳过，不把视频当歌曲。
- 已实际确认 feed_scene_mode.scene_mode_id 是 number，服务端提供45个情景模式和3个偏好。情景 stations 以 mode_id 或 familiar/fresh 建立独立feed会话；played_media 最多30项、去重集合有界、每次拉取最多2个上游页。主页通过MorePage继续读取；不会每次都重置成first。
- 已知PC protobuf列表终页可省略空数组；只在上述明确上下文中接受，不对未知形态递归猜测或全部转为空。has_more=true时缺list永远报错。

## Lyrics/comments 与 Actions 模块合同

`helper/community.cjs` 提供 `Community({api,now?})`：`lyrics({id})`, `comments({trackId,offset})`, `postComment({trackId,text})`, `clear`。`helper/actions.cjs` 提供 `Actions({api,invalidate,account?})`，只实现上面有请求依据的动作。

- 歌词解析支持普通LRC、字时间增强格式（如 `[start,duration]` 后 `<offset,duration,flags>word` 或 `(absoluteStart,duration,flags)word`），返回 `{lrc,translation}` 或 MyGo `lines/words`；正则处理长度≤1MiB、行数/词数限制，时间非负、end>=start、不执行HTML。纯文本/无歌词可返回原文LRC或空对象，格式损坏不得伪造时间。
- 评论时间秒→毫秒，root count→total，当前用户liked字段仅有明确state时映射；comments 使用独立 trackId/offset→cursor，PC省略has_more=false时终止，只有true才续页，不以cursor非空推导more。明确成功的终页若comments缺失可按protobuf空数组处理；有更多或无成功/计数元信息时缺list仍报错。
- 非幂等写操作发生网络错误须包装为固定的 mutation-unknown 文案（不可含原始响应、URL、Cookie），不自动重试。批量加歌逐个调用，指出已确认条目数量但不泄漏私有ID。

## 音质模块合同

原本 lossless 请求静默变192kbpsMP3，不算无损。本轮尝试支持服务端明确授权的 FLAC/MP4-FLAC：保留原始FLAC样本/解码信息，不从AAC转FLAC冒充无损；如果真实容器证据不足或格式不支持，明确 unavailable 而非静默冒充。缓存键、输出扩展名和MyGo.type必须按真实输出区分；需要VIP/购买则严格验证，不扩大已有权益。

## 验证门槛 / Phase 5

- 模块离线：输入边界、真实结构fixture、所有成功/空/错误/重复游标/上限/部分写入/无损拒绝场景。
- 独立审查：模块提交后新agent核对合同，blocking须修复再合并。
- 集成：真实index exports → JSONL catalog/actions/community → Runtime api，与模块真实实现连接，不只mock exports返回预设DTO。
- 运行时：Node单测 + MyGo0.1.7 moejs/host.spawn测试 + 真安装器目录/ZIP测试。
- 线上：只读账号接口、内容映射、分页和音频解码；写入测试仅模拟，除非用户另行明确同意特定账号动作。分类卡片、函数导出不等于全部页面完成。

## UI 布局

```
汽水音乐
├─ 首页推荐           [推荐歌曲] → 更多推荐
├─ 发现               [推荐歌单/模式/真实卡片]
├─ 榜单               [ranked_track 歌曲块]
├─ 我喜欢             [真实喜欢歌单分页]
├─ 收藏专辑           [mixed_collections 的 albums]
├─ 最近播放           [历史歌曲]
├─ 情景电台           [推荐/熟悉/新鲜/服务端模式]
└─ 我的歌单           [创建 + 收藏] → 详情/可验证操作
歌曲详情：歌词 + 评论；仅在支持相应动作时显示喜欢/收藏/评论按钮。
```

队列、快捷键、下载缓存、系统媒体键、窗口/主题等是 MyGo 宿主功能，不重新在插件实现。官方会员购买/直播/视频/隐私管理不在此Source接口范围。
