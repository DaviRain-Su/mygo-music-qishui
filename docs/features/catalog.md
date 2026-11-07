# Catalog read module

`helper/catalog.cjs` exports `Catalog`, `mapTrack`, `mapAlbum`, `mapArtist`, and
`mapPlaylist`. It imports only the existing protocol fault constructor. It never
reads storage, signs requests, performs network I/O, or changes playback policy.
All upstream requests use the injected `api(path, query, body?)`; omitted body
means GET. The only POSTs are the documented discover/feed reads.

## Integration interface

Construct `new Catalog({api, account, now?})`. `account` asynchronously returns a
verified account with a string `id`; `now` defaults to `Date.now`.

| Method | Result |
| --- | --- |
| `home()` | MyGo Browse with recommendation tracks and `morePage: 'feed:default'` |
| `browse({page})` | Browse; routes `home`, `discover`, `charts`, `history`, `library`, `feed:default` |
| `search({query,kind='tracks',offset=0})` | SearchResult for tracks/albums/artists/playlists; at most 20 items |
| `playlists()` | Playlist array, owned entries preferred over saved duplicates |
| `playlist({id})` | Playlist with complete tracks or an error |
| `liked({offset=0})` | Page of up to 100 tracks from a fully read liked playlist |
| `isLiked({ids})` | ID-to-boolean object, only after obtaining the complete liked set |
| `savedAlbums({offset=0})` | AlbumList of up to 100 explicitly classified album collections |
| `recent()` | Complete bounded history Track array or error |
| `stations()` | Station array: default/familiar/fresh plus server-listed scenes |
| `stationNext({id})` | Track array; scene IDs must occur in the server mode list |
| `invalidate(scope?)` / `clear()` | Synchronous cache/session reset; conservative invalidation clears everything |

Integration must call `clear()` on sign-out and `invalidate()` after attempted
mutations, including uncertain outcomes. Every read checks the injected account;
an ID change resets state. Reads are serialized. `clear()` and `invalidate()`
cancel all previously submitted reads, including queued reads and reads awaiting
account resolution, with `account`. They cannot call the API or repopulate caches
after cancellation. Reads submitted after the reset can proceed. Ordinary account
changes reset caches within the serialized read without cancelling later reads.

DTOs use MyGo field names. Track duration is preserved in milliseconds, covers
are placed in album.imageUrl, and no playable IDs are synthesized. A missing
album is represented by empty album ID/name, not a made-up navigable album.
PC `entity.track`, `entity.track_wrapper.track` with base/display/related info,
and direct entities are supported. Unsupported discover cards are skipped.
Playlist details prefer the observed `media_resources[].entity.track_wrapper.track`
shape on every page. Legacy `media` is accepted only when `media_resources` is
absent; a present malformed field fails instead of falling back. This applies to
`playlist`, `liked`, and `isLiked`.
Feed lists accept the `media` shape and the existing repository `items` fixture.
Missing required lists fail; unknown shapes are not recursively guessed.

## Pagination and bounds

- Search caches are independent per exact query and kind; offsets count unique
  returned DTOs. Cursors are opaque strings. Unknown offsets sequentially read
  at most eight upstream pages per call; unresolved offsets raise `pagination`.
  At most 16 search sessions and 5,000 unique items per session are retained.
- `has_more: false` takes precedence over stale cursors and totals. Otherwise,
  missing, repeated or cyclic next cursors, empty pages claiming more, and search
  pages with no new IDs raise `pagination`. Within-page duplicates are deduplicated.
- GET user-playlist/mixed responses with total_num but insufficient rows require
  a real next cursor. No offset-derived cursor is manufactured. A valid explicit
  list with neither total nor pagination metadata is accepted as a legacy
  single-response snapshot, including an explicit empty list. This compatibility
  rule cannot independently prove that an undocumented server omitted data.
- Discovery visits at most 5,000 inner blocks/resources in aggregate.
- Complete reads stop at 50 pages or 5,000 raw rows. At the limit, explicit more
  is an error. Every operation has a 25-second API budget, including awaited
  calls; account callback and queue waiting are outside that budget. Timeout
  cannot cancel an injected transport; late results are ignored.
- Likes require an owned type-1 playlist, with exact Chinese `我喜欢` or English
  `Liked` name fallback only. Missing liked playlist raises an error. Complete
  sets have a 30-second TTL; failures never create negative membership results.
- Feed state is separate from discovery and per station. Each advance makes at
  most two requests, uses at most 30 recent media entries, keeps at most 1,000
  deduplication IDs, and retains at most 16 sessions. Evicted sessions restart.
  The `played_media` feed context does not call the playback-history write API.
  A duplicate-only advance may return an empty batch after two pages, while home
  retains its MorePage if the service has not explicitly ended the feed. An empty
  page with `has_more: true` raises `pagination` immediately and leaves the session
  open; a later call continues with `is_first_request: false`. Explicit terminal
  empty pages (or legacy empty pages without `has_more`) end the session.
- IDs are 1–128 ASCII word/hyphen characters; queries max 512 characters;
  isLiked accepts at most 500 IDs; offsets must be nonnegative safe integers.

## Errors and remaining integration work

`protocol`, `response`, and `account` use existing faults. New **`pagination`**
uses the fixed message `汽水分页数据不完整或超过读取上限。`. Integration must add
this code/message to protocol public-error serialization; this task does not edit
protocol.cjs. Until then it will be serialized as the existing unavailable error.

No album/artist detail, search suggestions, or unverified endpoints are exported.
No host exports/dispatcher are connected by this task. Login, entitlement checks,
and playback are unchanged. Live endpoint validation and end-to-end host testing
remain integration work; these tests provide offline contract evidence only.
The sanitized feed-mode schema truncates scene entity internals: numeric scene
IDs and scene request payloads remain unverified by that evidence. Synthetic tests
do not establish those live contracts; integration must validate them before
claiming scene support.

## Verification

`node --test tests/helper-catalog.test.cjs`

TDD: initial suite failed for absent module; wrapper/input-method/non-track
regressions then failed before their implementation fixes. Fixtures are synthetic
and based on the supplied sanitized structural results and existing local feed
fixture. No account files, credentials, network, or server mutations were used.

Delivery: the original implementation was committed as
`df500f762327dec6b5bf08b9abe434698848fbd8` and independently reviewed in
`docs/plan/reviews/catalog-001-01.md`. That review is **BLOCKED**; its status has
not been changed by this repair. The three blocking findings now have local fixes:

- Observed playlist list/wrapper mapping across continuation and terminal pages,
  exercised through detail, liked, and membership reads; invalid preferred lists
  cannot silently fall back.
- Generation captured at submission and checked before/after account resolution;
  both reset methods cancel queued and account-pending work before API access.
- Contradictory empty feed continuation raises a pagination error without ending
  the session, with subsequent continuation and terminal-empty coverage.

The eight added regression tests failed before the fixes. Focused verification:
**36/36 passed**, including all 28 existing tests; none removed or skipped.
The stale delivery note is corrected here. Files are ready for orchestrator commit:
`helper/catalog.cjs`, `tests/helper-catalog.test.cjs`, `docs/features/catalog.md`.
No staging/commit was attempted during this repair, and no shared Git metadata was
modified. Independent re-review of the fixes, public pagination-error serialization,
host/dispatcher wiring, lifecycle invalidation, live schema validation (including
scene modes), and end-to-end host/installer tests remain integration obligations.
