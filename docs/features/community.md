# Community / Actions handoff

Implemented only in `helper/community.cjs` and `helper/actions.cjs`; no dispatcher,
index, protocol, authentication or playback changes. API dependencies are injected
as `api(path, query, body?)`. A body means POST; no body means GET. Runtime must
check API status before resolving. These modules never access account storage,
sign requests, perform their own network requests, or retry mutations.

## Exported interfaces

- `Community({api, now = Date.now})`: `lyrics({id})`,
  `comments({trackId, offset = 0})`, `postComment({trackId, text})`, `clear()`.
- `parseLyrics(lyric)` and `mapComment(raw)` are pure mapping exports.
- `Actions({api, invalidate, account?})`: `like({id,on})`,
  `savePlaylist({id,on})`, `saveAlbum({id,on})`, `createPlaylist({name})`,
  `addToPlaylist({playlistId,ids})`, `played({id})`. `on` must be boolean.
  `account` is accepted for compatibility but never invoked.
- Shared exports from actions: `mutate`, `error`, `object`, `id`, `text` are
  implementation utilities for Community, not dispatcher operations.

Like/save/played return `{ok:true}`. Create returns `{id,name}` only after a
nonempty response playlist id. Append returns `{confirmed}` and sends one request
per track in input order, stopping at the first error. Errors expose only a fixed
message/code, and append errors also expose the number of confirmed preceding
requests, never track ids or raw responses. Post returns a MyGo Comment with a
real response id and content. Missing create/post ids are uncertain outcomes,
not successful creations. No synthetic ids are generated.

## Integration obligations

Bind `api` to Runtime and `invalidate` to Catalog. Awaited invalidation scopes:
`liked`, `playlists` (create/append/save), `savedAlbums`, `recent`. The integration
adapter must invalidate dependent playlist/library views too (or clear Catalog
entirely). Invalidation runs after every attempted write, including API rejection
and unknown network outcomes. A throwing invalidator yields `cache` after an
otherwise successful write; it must not prompt an automatic retry. Post clears
that track's comment session even when the result is unknown. Call Community
`clear()` on sign-out/account change; integration must also cancel or isolate old
account operations. Each read holds its original session reference, so clear does
not repopulate the replacement session map.

Only invoke writes on explicit user actions. Only invoke `played` from the real
host played callback, never stream lookup or preloading. There are no unsupported
rename/delete/reorder/remove/follow/comment-like endpoints. Login and playback
entitlement contracts remain untouched.

New protocol error codes to register in the separate integration task:
`input`, `limit`, `pagination`, `mutation-unknown`, `cache`. Existing `response`
and `api` codes are also used. The fixed mutation-unknown message is:

> The action may have completed. Its result is unknown; check the current state before trying again.

Do not discard append `confirmed` at the public error boundary. It counts prior
confirmed appends; if invalidation itself throws after the next successful write,
that additional write may also have completed. No automatic retries are safe.

## Parsing and pagination limits

Lyrics use the existing POST `/luna/pc/track_v2` metadata payload, with no playback
or entitlement side effects. Ordinary LRC/plain text and Chinese translation are
returned verbatim as strings, never interpreted as HTML. Enhanced relative
`<offset,duration,flags>` and absolute `(start,duration,flags)` words produce MyGo
millisecond lines/words. Translation remains in the top-level LRC field.
Malformed times fail explicitly; ends must fit the enclosing line. Missing lyrics
return `{}`. Each source/translation is limited to 1 MiB UTF-8 and 10,000 lines;
enhanced lyrics allow 20,000 words. There is no guessed duration for plain LRC.

Comments map `time_created` seconds to milliseconds, root `count` to `total`, and
only boolean `liked` to liked state. Missing optional author/count/time fields are
omitted or empty; missing comment id/content or required page fields is an error.
`has_more:false` wins even with a nonempty cursor. Offsets identify page boundaries,
not upstream cursors. Unknown boundaries backfill at most eight requests per call,
with a 25-second elapsed budget checked around each request. Runtime must bound
individual network request time; this module cannot cancel a hanging injected API.
Duplicate comment ids, empty more-pages and missing/repeating/cyclic cursors fail.
Sessions are isolated by track, capped at 32 tracks, 50 cached pages per track,
10,000 traversed comments and 100 comments per response. Offset maximum is 10,000.
Concurrent reads of the same track reject with pagination rather than racing.
Evicted older offsets require `clear()` and a fresh bounded traversal.

Input ids are 1–256 ASCII letters/digits/underscore/hyphen; names 1–200 characters,
comments 1–5,000 characters, append batches 1–100 ids. All batch inputs validate
before sending any request.

## Verification and limits

TDD: first ran the new tests with absent modules and observed both module-load
failures, then implemented and passed the suite. Bounded offline command:

```
node --test tests/helper-community.test.cjs tests/helper-actions.test.cjs
```

15 tests cover payloads, unknown outcomes, no retry, partial append completion,
cache invalidation, malformed responses, lyric formats/translation/time/limits,
comment mapping, cursor termination/cycles/duplicates, and traversal budgets.
Only synthetic injected fixtures were used. No network, credentials or real
account data were accessed; the account-derived read-results file was deliberately
not read. Local source contracts and MyGo DTO declarations supplied context.
Real writes, host integration, and live response compatibility remain unverified.
