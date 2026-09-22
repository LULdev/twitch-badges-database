# fix-agent A — sync layer

Scope: `src/lib/syncs/` + `src/lib/twitch/` only. Verification for every
finding: `npx tsc --noEmit` (clean) and
`npx eslint src/lib/syncs/potat.ts src/lib/twitch/potat.ts src/lib/syncs/badgebase.ts`
(0 errors; one pre-existing unused-import warning in `badgebase.ts` that also
exists at HEAD and is unrelated to these edits). No production data was
mutated; no build was run.

## Fixed

### pdat-6 — duplicate rows in one upsert batch abort the whole sync (PG 21000)
- **File:line**: `src/lib/syncs/potat.ts:192-201`.
- **New behaviour**: `upsertRows` is collapsed into a `Map` keyed on
  `<set_id>:<version>` (last write wins) before it is chunked and sent to
  `badges.upsert(..., { onConflict: "set_id,version" })`, so each conflict key
  appears at most once per statement.
- **Why the old code was wrong**: two distribution entries can resolve to the
  same catalog row — the `byUuid` fallback matches *any* version sharing one
  image UUID, and the feed can repeat a badge — and both were pushed as
  separate objects with the same conflict key. Postgres rejects that with
  `21000 ON CONFLICT DO UPDATE command cannot affect row a second time`, thrown
  from `runPotatSync` after `distribution` had already succeeded, losing the
  whole sync. The chunked bulk-upsert shape is untouched (still 200/statement),
  so the ~6 s write path is preserved.

### pdat-8 — potat pagination silently truncated at the 50-page cap
- **File:line**: `src/lib/twitch/potat.ts:89-93` (`fetchAllDistribution`) and
  `:113-117` (`fetchAllOwners`).
- **New behaviour**: after each loop, a still-pending `cursor` (i.e. the loop
  exited on the 50-iteration bound while `hasNextPage` was true) throws instead
  of returning a truncated list.
- **Why the old code was wrong**: both loops `break` only when the API reports
  no next page; hitting the hard cap returned the first 10 000 rows with no
  signal. The remainder kept stale/null `owner_count`s and fed the rarity index
  from partial data (the null-overwrite path of pdat-1). `fetchAllOwners`
  failing is already handled by the caller (keeps existing counts), so raising
  there is safe; `fetchAllDistribution` is the authoritative row set and now
  fails the run loudly rather than silently under-reporting.
- **Left alone deliberately**: the `select("*")` on `src/lib/syncs/potat.ts:60`
  ("full-catalog load"/memory half of pdat-8). The rows are merged
  (`{ ...badge, … }`) into an `upsert`, so narrowing the projection would drop
  columns from the conflict path's INSERT tuple; Postgres validates NOT NULL
  on the proposed tuple even when every row conflicts, so a partial projection
  is not safe without also rewriting the write shape. The truncation signal is
  the part of pdat-8 that is actually a live defect.

### sync-3 — total badgebase detail outage recorded as a healthy heartbeat
- **File:line**: `src/lib/syncs/badgebase.ts:290-297` (after `logChange`, before
  the return).
- **New behaviour**: when at least one card was detailed and *every* detail
  fetch returned null (`capped.length > 0 && errors === capped.length`),
  `runBadgebaseSync` throws, so `withHeartbeat("sync/badgebase", …)` records
  `status: "error"` and `/api/cron/global` answers 207 instead of 200.
- **Why the old code was wrong**: the health/heartbeat call sites are outside
  this scope (`src/lib/health.ts`, the cron routes), so resolving with a
  summary that had `errors: 45` was recorded as `ok` — `system_heartbeats`, the
  uptime source of truth, showed green through a complete badgebase outage.
  Throwing from the sync is the in-scope lever that turns that into a failure.
  The sweep still runs (the throw is after it), so the DB work is not skipped.
  Partial failures keep resolving as before (a single flaky detail page is
  normal and must not mark the day degraded).

### sync-5 — stale start/end dates never cleared on the badgebase enrich path
- **File:line**: `src/lib/syncs/badgebase.ts:140-143` (date patch) and
  `:157-168` (status resolution).
- **New behaviour**: the patch now compares against the stored value directly,
  `null` included — `if (endDate !== existing.end_date) patch.end_date = endDate`
  (likewise `start_date`, `release_date`) — so a detail page that stops
  publishing a date clears the stale one; and `resolveStatus` is fed the same
  `startDate`/`endDate` the row will carry instead of falling back to
  `existing.*`.
- **Why the old code was wrong**: the truthiness guards skipped falsy incoming
  values, so when a window was extended or a bogus end date was removed
  upstream, the old `end_date` persisted and the row kept expiring on a date
  upstream no longer publishes (`resolveStatus` only rescues it while
  `is_confirmed_active`). Resolving status from the *stale* fallback while the
  patch would have written a different date was also internally inconsistent.

## Refuted (verified already fixed) — no change made

- **sync-4 — missing fetch timeouts.** Every third-party fetch in
  `src/lib/twitch/` already carries `signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)`
  (15 s): `badgebase.ts:18`, `ivr.ts:30`, `helix.ts:33` and `:93`,
  `perfil.ts:68` and `:85`, `potat.ts:37`, `:48`, `:173`, `:226`, `:285`. No
  fetch remains without one; nothing to fix.
- **sync-6 — oversized `.in()` filter.** The reported
  `.in("set_id", incoming.map((v) => v.setId))` no longer exists. The only
  `.in()` calls left in the sync layer are chunked at 200:
  `syncs/global.ts:205` (`.in("id", batch.map(...))`) and `:227`
  (`.in("slug", batch)`). This was fixed as a documented side effect of the
  sync-1 fix (`bugreports/fixproposal-sync.md`, residual-risk note).
- **sync-7 — non-constant-time cron secret comparison.** No direct comparison
  remains anywhere: all three cron routes call
  `isAuthorizedCron()` (`src/lib/cron-auth.ts`), which compares SHA-256 digests
  with `crypto.timingSafeEqual`. `grep` for `authorization.*!==` /
  `Bearer ${secret}` across `src/` finds only the explanatory comment in
  `cron-auth.ts`.

## Not fixable within this agent's exclusive scope

These two are real (confirmed from the code) but their write sites are outside
`src/lib/syncs/` + `src/lib/twitch/`, and the task states an out-of-scope edit
"will be lost or will break theirs". Left untouched; a note so the owning agent
(or a later pass) can act.

- **pdat-5 — profile sync clobbers good fields; route answers ok.** The two
  writers are `src/lib/inventory.ts:141-149` and `:157-165` (unconditional
  `display_name`/`avatar_url`/`potat_level`/`potatoes` updates), and the
  `{ok:true}`-regardless response is `src/app/api/inventory/sync/route.ts:26-28`
  — both outside scope. The `""` value originates in
  `src/lib/twitch/perfil.ts:normalize()` (in scope), but changing it there would
  not fix the bug: the actual defect is that inventory.ts *writes* empty/null
  over good data regardless of what `normalize` returns, so any change at the
  reader is a non-fix.
- **pdat-7 — stats aggregations capped at PostgREST's 1000-row default.** All
  cited sites are in `src/lib/queries.ts` (`getSiteStats` rarity/category
  selects around `:532-556`, `getCatalogKeys()` `limit(3000)` around
  `:472-483`) — outside scope. The correct fix (aggregate in a `stats_*` view /
  RPC, or page with `.range()`) requires `queries.ts` and, for the view, a
  migration, neither of which this agent may edit.

## Files touched
- `src/lib/syncs/potat.ts`
- `src/lib/syncs/badgebase.ts`
- `src/lib/twitch/potat.ts`
- `bugreports/fix-a-syncs.md` (this report)