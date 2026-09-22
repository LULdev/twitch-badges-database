# Server-side verification audit — NEW defects

Date: 2026-09-22. Fresh independent read-only pass over the server seams
(`src/app/api/*`, `src/lib/syncs/*`, `src/lib/twitch/*`, service-role import
sites, PostgREST/`scripts` usage). Working tree read at HEAD (`e003082`).

Nothing below repeats an item in `bugreports/AGENT-AUDIT.md` (fixed or open) or
in `bugreports/verify-round8.md` / `verify-independent.md` / `verify-round10.md`.
Where an existing item comes close (pdat-1, pdat-7, cron-5) the report says so
and shows why the code path here is distinct.

Method: read every file under `src/app/api/` and the client component that calls
it; read the three sync engines and their provider fetchers end to end; matched
each service-role import site against what can reach it; ran read-only anon-key
probes against the live project (`badge_stats` only — never mutated anything,
never printed a secret).

Convention per finding: ID · severity · side · file:line · evidence ·
consequence · confidence · fix direction.

---

## srv-1 — one empty-but-valid catalog response marks the ENTIRE catalog `removed`, and the run still records a healthy heartbeat

- **Severity**: high
- **Side**: server / sync / data-destructive
- **File:line**:
  - `src/lib/syncs/global.ts:50-53` — the fetch and the derived `incoming` list
  - `src/lib/syncs/global.ts:89-94` — `incomingKeys` / `incomingUuids`
  - `src/lib/syncs/global.ts:176-188` — the "removed" sweep
  - `src/lib/syncs/global.ts:197-211` and `:330-347` — the destructive write and its events
  - `src/lib/twitch/catalog.ts:11-17`, `src/lib/twitch/helix.ts:105`,
    `src/lib/twitch/ivr.ts:37-42` — no empty guard in any of the three
- **Evidence**: there is no guard anywhere for "the provider answered successfully
  but with no sets":
  ```ts
  const { sets, source } = await fetchGlobalBadgeCatalog();      // may be { sets: [] }
  const incoming = sets.flatMap((s) => s.versions).filter(...);  // []
  ...
  const incomingKeys = new Set<string>();   // empty
  const incomingUuids = new Set<string>();  // empty
  for (const [key, ex] of existing) {
    if (incomingKeys.has(key) || ex.status === "removed") continue;   // never true
    const uuid = extractBadgeUuid(...);
    if (uuid && incomingUuids.has(uuid)) continue;                    // never true
    removed.push({ id: ex.id, title: ex.title });                     // EVERY row
  }
  ```
  Then `upsert(removed)` → `update({status:"removed", removed_at: now})` for every
  id (line 199-209), a `badge_events` "removed" row per badge and a changelog
  "… badges no longer available" (lines 330-347). `isInitialSeed` (line 216) does
  not help: it is only true when `existing.size === 0`, in which case `removed`
  is empty.
  The fetchers return `[]` without throwing: `fetchGlobalBadgeCatalog` does
  `if (helix) return { sets: helix, source: "helix" }` — `[]` is truthy — and
  the IVR fallback only checks `Array.isArray(list)` (ivr.ts:39). So a 200 with
  an empty payload from either source flows straight into the sweep.
  Because `runGlobalSync` **resolves**, `withHeartbeat("sync/global")` records
  `status: "ok"` (`src/lib/health.ts:76-81`), and the route answers `ok: true`.
- **Consequence**: a single empty response from Helix or ivr.fi (upstream
  incident, partial cache miss, a `data: []` body) empties the whole catalog:
  all ~475 badges get `status:"removed"` + `removed_at`, ~475 spurious
  `badge_events` rows and a false "N badges no longer available" changelog are
  written, and `/badges`, `/active`, `/upcoming` and the sitemap go blank. The
  next global cron (daily) only restores rows present in the live catalog again;
  until then `system_heartbeats` reports the run as **ok**. The badgebase sweep
  that runs after it in the same request resurrects only what is on its own
  `/active` list, so permanent/subscriber badges stay `removed` for the day.
- **Confidence**: high on the control flow (pure code reading; the sweep sets are
  provably empty). The trigger — a 200 with an empty list — is external and not
  reproduced here; the point is that nothing in the code refuses it.
- **Fix direction**: refuse to run the removal sweep on an empty incoming set —
  `if (incoming.length === 0 && existing.size > 0) throw new Error("catalog fetch returned no sets — refusing to treat every badge as removed")`
  before the sweep (and make the fetchers throw on an empty list). This is the
  same defensive shape the inventory sync already uses for its perfil response
  (`src/lib/inventory.ts:67-71`).

---

## srv-2 — the potat sync still nulls every `owner_count` when the owners feed answers 200 with an empty list (the pdat-1 fix covers only the thrown case)

- **Severity**: medium
- **Side**: server / sync / data-quality
- **File:line**:
  - `src/lib/syncs/potat.ts:45-53` — the `ownersOk` flag
  - `src/lib/syncs/potat.ts:71-74` — `ownersByBadge` built from the response
  - `src/lib/syncs/potat.ts:139-143` — `totalOwners`
  - `src/lib/syncs/potat.ts:176-207` — the destructive upsert and the appended point
  - `src/lib/twitch/potat.ts:99-120` — `fetchAllOwners` returns `[]` on success
- **Evidence**:
  ```ts
  const totalOwners = ownersOk
    ? (ownersByBadge.get(`${row.badge}:${row.version}`) ?? null)   // <- null when the map is empty
    : (badge.owner_count as number | null);
  const valuesChanged = totalOwners !== badge.owner_count || ...;
  ```
  `ownersOk` is `ownersResult.ok`, which is `true` for any *resolved* fetch —
  including one that returned an empty array. `fetchAllOwners`
  (`twitch/potat.ts:99-120`) resolves `[]` when the API returns
  `{ data: [], pagination: { hasNextPage: false } }` (or no pagination at all):
  the loop breaks on `!cursor` and the `if (cursor) throw` cap check never fires.
  So `ownersByBadge` is empty, every `ownersByBadge.get(...)` is `undefined`,
  `?? null` produces `null`, `valuesChanged` is `true` against a real count, and
  the bulk upsert writes `owner_count: null` (and `percentage`) for every matched
  badge, appends `null` `badge_stats` points (lines 200-207) and feeds the
  recomputed rarity score from nulls.
- **Consequence**: an owners endpoint that answers 200 with no rows (a quiet
  upstream partial, a shape change) zeroes the entire owner/rarity index for the
  run and permanently appends `null` points to the per-badge time series. The
  counts self-heal on the next 15-minute GH-Action run, but the appended null
  stats points do not, and the changelog still says nothing
  (`ownersFeedOk` is only `false` when the fetch *threw*).
  This is the pdat-1 failure mode, which the project rated High; its fix
  (`.catch(() => ({ ok: false, rows: [] }))`) only covers the *rejected* fetch,
  not a resolved-but-empty one — a distinct path from the fixed finding.
- **Confidence**: high on the mechanism (control flow + the fetcher's break
  condition). Trigger likelihood unmeasured.
- **Fix direction**: treat "resolved and empty" like the failure it is —
  `const ownersOk = ownersResult.ok && ownersResult.rows.length > 0;` (or keep a
  separate `ownersFeedEmpty` flag and reuse the existing keep-existing-counts
  branch), and carry it into the summary/heartbeat.

---

## srv-3 — the badge-detail owner-history chart returns the OLDEST 250 points, so it freezes once a badge passes 250 samples

- **Severity**: medium
- **Side**: server / query
- **File:line**:
  - `src/lib/queries.ts:274-291` — `.order("polled_at", { ascending: true }).limit(limit)`
    (`:283` order, `:284` limit, default `limit = 250` at `:277`)
  - `src/app/[locale]/badges/[slug]/page.tsx:83` (fetch) and `:287-288`
    (`<OwnersChart data={chartData} />`)
- **Evidence**: the query orders ascending *and then* limits, which selects the
  earliest 250 rows, not the most recent 250:
  ```ts
  .from("badge_stats")
  .select("polled_at, owner_count, active_count")
  .eq("badge_id", badgeId)
  .order("polled_at", { ascending: true })
  .limit(limit);
  ```
  Live anon probe (read-only): `badge_stats` holds **5686 rows across 311 badges,
  max 19 rows for a single badge**, spanning 2026-09-20T03:52 → 2026-09-22T07:13
  (~2.1 days since the series began), i.e. ~9 points/day/badge. There is no
  retention on `badge_stats` anywhere in the repo (`grep` for `badge_stats`
  shows only the insert in `potat.ts:228` and this read — no prune), so the
  per-badge series grows without bound while the query keeps returning its first
  250 points.
- **Consequence**: roughly four weeks after a badge's first sample, its
  `OwnersChart` on `/badges/<slug>` stops incorporating new data — it keeps
  drawing the earliest ~250 points and the last month of activity is invisible,
  silently (no error, still `>= 2` points so the chart renders). Every badge
  reaches this at the same time, shortly after launch.
- **Confidence**: confirmed (live row counts + pure query semantics).
- **Fix direction**: order `descending` and `.limit(250)`, then reverse the array
  before mapping to `chartData` (or page backwards from the newest point); add a
  retention job for `badge_stats` if the unbounded growth matters.

---

## srv-4 — the IP hash is "salted" with a `NEXT_PUBLIC_*` value, so it is not pseudonymous

- **Severity**: low
- **Side**: server / privacy
- **File:line**: `src/lib/gamification/session.ts:35-41`
- **Evidence**:
  ```ts
  /** Stable pseudonymous visitor hash from the client IP. */
  function hashIp(ip: string): string {
    return createHash("sha256")
      .update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "tbd"}`)
      .digest("hex")
      .slice(0, 40);
  }
  ```
  The salt is `NEXT_PUBLIC_SUPABASE_URL` — the same value the browser client
  inlines into its bundle (`src/lib/supabase/browser.ts:49`, and `.env.local:2`).
  It is therefore public, and `sha256(ip + ":" + <known public string>)` is
  trivially reversible by brute force over the ~4.3-billion-address IPv4 space.
  The hash is stored as `blog_views.ip_hash`, `blog_reactions.ip_hash`,
  `profile_visits.ip_hash` and `coin_rain_gate.giver_key`
  (`src/lib/syncs/…`, `src/app/api/…`), and `ipHashFromRequest` is passed into
  `/api/coinrain` as the gate key (`src/app/api/coinrain/route.ts:12`).
- **Consequence**: the stored "pseudonymous" visitor identifier is a reversible
  encoding of the visitor's IP address, not a pseudonym. The column grants in
  0011 deliberately hide `ip_hash` from anonymous reads, which shows the intent
  was that the hash is not sensitive; with a public salt it is. Viewed today the
  impact is limited (the hash is not itself publicly readable, and
  `coin_rain_gate` is service-role-only), which is why this is rated low — but a
  data subject's IP is recoverable from any leak of these columns and the code
  comment's "pseudonymous" claim is false.
- **Confidence**: high on the mechanism (the salt is demonstrably a public
  variable); no direct live exploit path demonstrated.
- **Fix direction**: salt with a server-only secret (`SUPABASE_SERVICE_ROLE_KEY`
  is convenient but rotating; a dedicated `IP_HASH_SALT` is better) read through
  `envOr`, not an `NEXT_PUBLIC_*` name.

---

## srv-5 — the badgebase sync has no empty-listing guard either: an empty `/active` listing clears `is_confirmed_active` and demotes dateless badges

- **Severity**: low
- **Side**: server / sync
- **File:line**:
  - `src/lib/syncs/badgebase.ts:68-77` — listing fetch (no empty check)
  - `src/lib/syncs/badgebase.ts:106-110` — `activeKeys` built from the listing
  - `src/lib/syncs/badgebase.ts:221-264` — the demotion sweep
  - `src/lib/syncs/badgebase.ts:293-297` — the only guard, which requires cards
- **Evidence**: the sole protective check is
  `if (capped.length > 0 && errors === capped.length) throw ...`. When the listing
  pages parse to zero cards (`fetchBadgebaseListing` returns `[]` for a 200 page
  whose markup no longer matches the anchor regex — `twitch/badgebase.ts:52-99`,
  purely structural), `capped` is empty, so the guard cannot fire. `activeKeys`
  is then empty and the sweep (`:245-263`) resolves every dateless row to
  `expired` and writes `is_confirmed_active: false` for every badge that is not
  already on the active list.
- **Consequence**: an empty/redesigned listing silently clears the authoritative
  activity flag for the whole catalog and demotes dateless badges to `expired`
  for that run (self-heals on the next successful listing, so this is lower
  impact than srv-1). Reported only as the sibling site of srv-1 — same class,
  different engine.
- **Confidence**: high on the code path; trigger is a markup/empty-listing event.
- **Fix direction**: treat `activeCards.length === 0` as a failure of the run
  (throw before the sweep), matching the existing all-details-failed guard.

---

## srv-6 — two catalog reads still silently truncate at PostgREST's 1000-row cap (the pdat-7 fix covered `queries.ts` only)

- **Severity**: low (latent)
- **Side**: server / query
- **File:line**:
  - `src/app/sitemap.ts:39-43` — `.select("slug, updated_at").neq("status","removed").limit(3000)`
  - `src/lib/inventory.ts:26-29` — `.select("id,set_id,version").neq("status","removed")` (no limit/range/paging)
- **Evidence**: PostgREST caps a single response at its `max-rows` default (1000)
  — the premise the project itself accepted for pdat-7 and codified in migration
  0013's header ("`getSiteStats()` … whose response cap is 1000 rows"). A
  `.limit(3000)` above that default never yields more than 1000 rows, and an
  unpaged select is bounded the same way. `getCatalogKeys()`
  (`src/lib/queries.ts:534-546`) was fixed to page with `.range()`; these two
  call sites were not.
- **Consequence**: once the catalog passes 1000 badges, the sitemap omits every
  badge page after the first 1000 (badges 1001+ are never submitted to search
  engines), and `syncUserInventory` matches `perfil.badges` against only the
  first 1000 catalog rows, so a collector's badges beyond that window are
  counted `unmatched` and any previously stored one is deleted from
  `user_inventory` on the next sync. No live impact today (475 badges); the
  failure is silent when it starts.
- **Confidence**: high on the mechanism; latent (catalog under the cap today).
- **Fix direction**: reuse the `getCatalogKeys().range()` pattern (or a
  `stats_*`/RPC for the sitemap projection).

---

## Areas checked and found clean

- **All 19 files under `src/app/api/`** read end to end, each paired with the
  client that calls it: `/api/account` (ProfileCustomizer, AccountSettings —
  status-only), `/api/blog/react` (EmojiReactions reads `added`/`removed`),
  `/api/changelog/rss`, `/api/coinrain` (CoinRainButton reads `ok`/`already`),
  the three cron routes, `/api/daily/claim` (DailyClaim reads `xp`,`coins`,
  `streak`, 429 = already), `/api/feed` (FeedList), `/api/games/play`
  (`useGame`: `ok`,`error`,`bet`,`payout`,`won`,`balance`), `/api/games/symbols`
  (Catcher/Memory/Shoot/Slots read `symbols`), `/api/health` (LiveStatus),
  `/api/inventory/sync` (SyncButton status-only, `degraded` is advisory),
  `/api/og/profile`, `/api/progress` (useGame `coins`, WheelOfFortune
  `wheelSpunToday`), `/api/push/subscribe` + `/api/push/vapid` (PushToggle),
  `/api/steal` (StealPanel `ok`/`error`/`success`/`stolen`/`cost`),
  `/api/wheel/spin` (WheelOfFortune `slot.id`/`turboWon`). **No route's response
  body disagrees with what its consumer reads.**
- **CRON_SECRET**: `isAuthorizedCron` (`src/lib/cron-auth.ts:12-20`) hashes
  `Bearer <secret>` and the incoming header separately and compares with
  `crypto.timingSafeEqual` on fixed-length digests — constant-time and
  length-independent; all three cron routes call it before any work. (The
  non-constant-time comparison is `sync-7`, already fixed and reported.)
- **Heartbeat truthfulness (apart from srv-1/srv-2)**: `withHeartbeat` rethrows
  and records `error`; `cron/global` records `degraded` on an explicit
  `badgebaseFailed` flag (not truthiness) and prunes on both the success and the
  early-return path (`cron-3`/`cron-6` fixed); `/api/health` writes at most one
  `web` row per minute per instance (`cron-1` fixed).
- **Service-role client**: every import site enumerated (32 sites across
  `src/`, `scripts/`). No module containing `"use client"` imports
  `@/lib/supabase/admin`; `SUPABASE_SERVICE_ROLE_KEY` appears only in `admin.ts`.
  The anonymous-reachable routes that use it (`/api/feed`, `/api/games/symbols`,
  `/api/health`) are read-only with fixed projections/limits, and the two
  anonymous-reachable write routes (`/api/push/subscribe`, `/api/blog/react`)
  validate input and scope every mutation to the caller's own row/endpoint.
- **`scripts/` re-run safety**: `db-apply.ts` runs each migration and its ledger
  row in one transaction; `seed-gamification-blog.ts` / `seed-xp-research.ts`
  upsert by slug with `ignoreDuplicates`; `log-change.ts` is append-only;
  `send-push.ts` and the `sync-*.ts` wrappers delegate to the sync engines and
  hold no state. No re-run path that can corrupt data beyond srv-1/srv-2's
  provider-input dependency.
- **PostgREST pagination loops**: `getCatalogKeys` (`queries.ts:534-546`) pages
  with a stable `id` tiebreak and terminates on a short page; `listBadges`'
  page clamp/recursion (`queries.ts:207-242`) terminates because `pages <= page`
  on the recursive call; the global-catalog load (`global.ts:76-86`) pages in
  1000-row windows until a short page. No early-terminating range loop found.
- **potat distribution pagination**: the 50-page cap throws instead of
  truncating (`twitch/potat.ts:92-94`), the distribution failure aborts before
  any write (`syncs/potat.ts:60-68`), and duplicate `(set_id, version)` rows are
  collapsed before the upsert (`syncs/potat.ts:210-225`) — the pdat-2/pdat-6/
  v10-4 fixes hold.
- **badgebase detail outage**: an all-details-failed run throws before the
  heartbeat is recorded as ok (`syncs/badgebase.ts:293-297`, `sync-3`); removed
  rows are matched by image UUID and can be resurrected (`global.ts:183-186`,
  `badgebase.ts:169-174`, `sync-2`); `fetchBadgebaseListing` derives tags/dates
  from `data-*` attributes and skips malformed cards.

## Summary

| ID | Severity | Confidence | One line |
|---|---|---|---|
| srv-1 | high | high (code) | an empty-but-valid catalog response marks every badge `removed` and still records an `ok` heartbeat |
| srv-2 | medium | high (code) | a 200 owners feed with an empty list nulls every `owner_count` (pdat-1 covers only the thrown case) |
| srv-3 | medium | confirmed | the badge owner-history chart returns the oldest 250 points and freezes after ~4 weeks |
| srv-4 | low | high (code) | the IP hash salt is a `NEXT_PUBLIC_*` value, so the "pseudonymous" hash is reversible |
| srv-5 | low | high (code) | an empty badgebase listing clears `is_confirmed_active` and demotes dateless badges |
| srv-6 | low (latent) | high (code) | sitemap and inventory catalog reads still rely on the 1000-row PostgREST cap |

No API route's response body was found to disagree with the client that reads it,
CRON_SECRET handling is sound, and the service-role client is confined to
server-only contexts. The two findings that matter are both provider-input
shapes (srv-1, srv-2) that no existing guard refuses; srv-3 is a plain query
defect with a near-term, silent user-visible effect.