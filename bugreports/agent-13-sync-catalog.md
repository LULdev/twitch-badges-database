# Bug report — agent-13 "sync-catalog"

Scope: `src/lib/syncs/global.ts`, `src/lib/syncs/badgebase.ts`,
`src/lib/twitch/{helix,ivr,badgebase,catalog,types}.ts`, `src/lib/rarity.ts`,
`src/lib/health.ts`, `src/app/api/cron/global/route.ts`.

## sync-1: New-badge fan-out re-publishes up to 10 pre-existing badges as new drops
- **Severity**: high
- **Side**: server
- **File**: src/lib/syncs/global.ts:199-206, 232-249
- **Evidence**:
  ```ts
  .from("badges")
  .select(...)
  .in("set_id", incoming.map((v) => v.setId))
  .order("first_seen_at", { ascending: false })
  .limit(addedTitles.length + 10);
  ...
  if (!isInitialSeed) {
    for (const row of freshRows) {
      await createDropPost({ slug: row.slug, ... }, supabase);
  ```
- **Why it is a bug**: `freshRows` selects the newest rows across *all* catalog
  `set_id`s, not the rows actually inserted this run. With N new badges the
  query returns N+10 rows, so up to 10 already-existing badges are treated as
  fresh: they get a duplicate `badge_events` `added` row and a duplicate
  `createDropPost()` blog post on every non-seed run that adds a badge.
- **Confidence**: confirmed
- **Fix direction**: Collect the inserted rows' ids/slugs during the upsert
  loop (or re-select by the exact new ids) and only fan out over those.

## sync-2: Global "removed" sweep can permanently kill badges inserted by badgebase
- **Severity**: high
- **Side**: server
- **File**: src/lib/syncs/global.ts:164-169; src/lib/syncs/badgebase.ts:180-205, 164
- **Evidence**:
  ```ts
  for (const [key, ex] of existing) {
    if (!incomingKeys.has(key) && ex.status !== "removed") removed.push(...)
  ```
  badgebase inserts with `set_id: card.slug` (comment: "matches the catalog
  set_id **in most cases**"), and later refuses status repair:
  ```ts
  if (status !== existing.status && existing.status !== "removed") patch.status = status;
  ```
- **Why it is a bug**: any badgebase-announced badge whose slug is not byte-
  equal to Twitch's `set_id` (the "not most" case) is absent from
  `incomingKeys`, so the next global run sets it `removed`. badgebase runs
  after global and both its enrich path and sweep skip `status === "removed"`,
  so a redeemable badge stays `removed` forever.
- **Confidence**: likely
- **Fix direction**: match badgebase to Twitch by image UUID before deciding
  removal, or let badgebase re-activate rows (clear `removed`/`removed_at`)
  for cards confirmed on `/active`.

## sync-3: Heartbeat reports "ok" when every badgebase detail fetch failed
- **Severity**: medium
- **Side**: server
- **File**: src/lib/syncs/badgebase.ts:44-48, 112-115; src/app/api/cron/global/route.ts:39, 50
- **Evidence**:
  ```ts
  try { results[index] = {...} } catch { results[index] = { item: items[index], result: null }; }
  ...
  if (!detail) { errors += 1; continue; }
  ```
  and `withHeartbeat("sync/badgebase", () => runBadgebaseSync())` resolves
  normally, so `status: "ok"` is recorded; cron sets `status: badgebase ? "ok"
  : "degraded"` where a summary object is always truthy.
- **Why it is a bug**: a total badgebase outage (all 45 detail fetches fail)
  is recorded as healthy, so `system_heartbeats` — the uptime source of truth —
  shows green while no badge got a real claim window.
- **Confidence**: confirmed
- **Fix direction**: treat `errors > 0` (or a failure ratio) as `degraded` in
  the heartbeat, and surface it in the cron response.

## sync-4: No timeout/retry/backoff on upstream catalog fetches
- **Severity**: medium
- **Side**: server
- **File**: src/lib/twitch/badgebase.ts:12-21; src/lib/twitch/ivr.ts:25-31; src/lib/twitch/helix.ts:28-35, 87-97
- **Evidence**: `await fetch(url, {...})` with no `signal`/timeout and no retry
  in `fetchHtml`, `fetchGlobalBadgesIvr`, `fetchGlobalBadgesHelix`.
- **Why it is a bug**: a hung or 5xx-twice upstream makes the 60 s serverless
  cron (`maxDuration = 60`) time out with no partial result; transient
  429/5xx from badgebase/ivr are never retried. (potat has `Retry-After`
  handling per AGENTS; these do not.)
- **Confidence**: confirmed
- **Fix direction**: add an `AbortSignal.timeout(...)` plus 1-2 bounded
  retries with backoff to the shared fetch helpers.

## sync-5: Stale date fields are never cleared in the badgebase enrich path
- **Severity**: medium
- **Side**: server
- **File**: src/lib/syncs/badgebase.ts:136-140
- **Evidence**:
  ```ts
  if (startDate && startDate !== existing.start_date) patch.start_date = startDate;
  if (endDate && endDate !== existing.end_date) patch.end_date = endDate;
  if (releaseDate && releaseDate !== existing.release_date) patch.release_date = releaseDate;
  ```
- **Why it is a bug**: when a detail page drops or corrects its
  `temporalCoverage` (window extended, or bogus end removed), the falsy value
  is ignored and the old `end_date`/`start_date` persists. The row then expires
  at a date upstream no longer publishes; `resolveStatus` only rescues it while
  `is_confirmed_active` is true.
- **Confidence**: likely
- **Fix direction**: null out `end_date`/`start_date` when the detail page
  provides no value and the field was previously populated.

## sync-6: Unbounded `.in(...)` set_id filter in the fresh-badge query
- **Severity**: low
- **Side**: server
- **File**: src/lib/syncs/global.ts:204
- **Evidence**: `.in("set_id", incoming.map((v) => v.setId))`
- **Why it is a bug**: `incoming` is `sets.flatMap(versions)` for the whole
  global catalog; every version's `setId` is serialized into the PostgREST
  query string. On a growing catalog (or the initial seed, where
  `addedTitles.length` is large) this can exceed the REST URL length and return
  a 414/400, aborting the sync after the badges were already upserted.
- **Confidence**: unconfirmed
- **Fix direction**: query by the known new rows (or chunk the `.in` list).

## sync-7: Non-constant-time CRON secret comparison
- **Severity**: low
- **Side**: server
- **File**: src/app/api/cron/global/route.ts:12
- **Evidence**: `if (!secret || auth !== \`Bearer ${secret}\`)`
- **Why it is a bug**: plain `!==` on the bearer token is byte-by-byte
  short-circuiting; the timing side channel is theoretically distinguishable.
  Low impact for a random `CRON_SECRET`, but it is the route's auth check.
- **Confidence**: confirmed
- **Fix direction**: compare with `crypto.timingSafeEqual` over equal-length
  buffers.

---

Checked and found sound: `resolveStatus` precedence (confirmed-active wins
over an elapsed `end_date`, future `start_date` still yields `upcoming`
types.ts:122-141); `data-reset` is not parsed anywhere; status badges are
filtered in both syncs and deleted from the catalog; heartbeat writes
never throw (health.ts:27-41); rarity weights sum correctly and guards against
NaN (`rarity.ts:60-127`); no unbounded pagination in helix/ivr (global
endpoints are single-page); `mapLimit` cursor increment is atomic enough in
single-threaded JS.