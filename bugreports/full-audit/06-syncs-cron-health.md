# Data pipelines: syncs, provider clients, cron routes, health

Audited: `src/lib/syncs/global.ts`, `src/lib/syncs/badgebase.ts`,
`src/lib/syncs/potat.ts`, `src/lib/twitch/{helix,ivr,badgebase,potat,catalog,types}.ts`,
`src/app/api/cron/{global,potat,badgebase}/route.ts`, `src/lib/health.ts`,
`src/lib/cron-auth.ts`, `src/lib/stats.ts` (uptime semantics), `src/app/api/health/route.ts`,
`src/app/api/admin/sync/route.ts`, `src/lib/admin-content.ts` (badge upsert +
`source='custom'`), `src/components/admin/BadgesPanel.tsx`,
`supabase/migrations/0001_init.sql` + `0004_stats_uptime.sql` (uptime views),
`scripts/{sync-global,sync-badgebase,sync-potat,db-apply,log-change,send-push}.ts`,
`scripts/_tmp-role2.mjs`, `.github/workflows/potat-sync.yml`, `vercel.json`.

Method: read-only inspection of every file above; `node -e` read-only queries against
`SUPABASE_DB_URL` (catalog counts, per-source heartbeat status, duplicate artwork UUIDs,
slug-normalisation collisions); one read-only fetch of `badgebase.de/active` and
`/upcoming/` to count the live card list. I did not run `npm run db:apply`, never wrote to
the DB, and did not run the sync scripts. The live catalog at audit time: **476 badges**
(0 `source='custom'`, 0 removed, 23 `is_confirmed_active`, 433 dateless); badgebase listing
**23 active + 18 upcoming = 41 cards** (under the 45-card detail cap).

Already-known items deliberately **not** re-reported: pdat-1…pdat-8 (owners-feed nulling,
the potat 429 retry, duplicate-row batches → PG 21000, the PostgREST 1000-row cap in
`queries.ts`/stats views, the stats-view truncation), cron-1…cron-6 (public `/api/health`
write amplification, the 200-on-badgebase-failure, prune coupling, `db:apply` atomicity,
non-constant-time secret compare + `maxDuration` vs `--max-time`, degraded-from-truthiness),
sync-1…sync-7 (N+10 fan-out, key-based removal sweep, all-details-failed heartbeat,
missing fetch timeouts, stale date fields), and the round-12/13/17 findings (`liveExisting`
guard arithmetic, `guessCategory`'s missing boundary, the badgebase empty-listing guard as
written). **All of those are fixed in the current tree** except pdat-6 (global's batches
still have no `(set_id,version)` collapse — 0 duplicate keys live, so inert) and
v17-05's observation that a `degraded` row never moves the headline gauge (B5 below is the
part of that which is still unreported: `manual/*` rows can pin the gauge at `degraded`).

---

## B1 — The badgebase sweep demotes admin-authored `source='custom'` badges; the global sweep deliberately does not
- **Severity**: high
- **Confidence**: high (mechanism verified by reading; latent — 0 custom rows live today)
- **Where**: `src/lib/syncs/badgebase.ts:261-300` (no `source` filter), `src/lib/syncs/global.ts:269`, `src/lib/syncs/potat.ts:167-178`, `src/components/admin/BadgesPanel.tsx:95`, `src/lib/admin-content.ts:377`
- **Code** (badgebase sweep; `row` comes from an unfiltered `select("*")` at `:84-90`):
  ```ts
  for (const row of allBadges) {
    ... const onActiveList = activeKeys.has(row.set_id as string) || ...;
    if (row.status === "removed") { ... continue; }
    if (onActiveList) continue;
    const nextStatus = resolveStatus({ start_date: ..., end_date: ...,
      is_confirmed_active: false }, now);          // dateless + unconfirmed => "expired"
    if (row.status !== nextStatus || (row.is_confirmed_active as boolean)) {
      sweepRows.push({ ...row, is_confirmed_active: confirmed, status: nextStatus });
  ```
  while `global.ts` guards the same rows explicitly:
  ```ts
  // global.ts:269 — inside the removal sweep
  if (ex.source === "custom") continue;
  ```
- **Why it is wrong**: `global.ts` treats `source='custom'` as admin-owned (lines 81-98 and
  269, with a comment explaining that the dashboard owns those rows). The badgebase sweep
  has **no such exemption** — it recomputes a status for *every* catalogue row. The admin
  panel's "new badge" form defaults to `status: "active"` with `start_date`/`end_date`
  `null` (`BadgesPanel.tsx:88-104`) and saves `status` verbatim (`:262`), and
  `upsertBadge` stamps `source='custom'` (`admin-content.ts:377`). So the very first badge
  an operator creates through the dashboard is written as active/dateless and is then
  demoted to `status='expired'` by the next daily drop-window sync — the daily cron order
  is `runGlobalSync()` then `runBadgebaseSync()`, so it happens within 24 h. If the row was
  ever `is_confirmed_active`, that flag is cleared too. No per-badge changelog row is
  written by the sweep (only the aggregate `data_sync` summary), so the operator is never
  told. `resolveStatus({start:null,end:null,is_confirmed_active:false})` returns
  `"expired"` (`types.ts:155`), so the condition above is always true for such a row.
  The potat sweep (`potat.ts:167-178`) recomputes status the same way for every row matched
  from its feed, so a custom badge that potat knows is also demoted within 15 minutes.
- **How to reproduce**: by inspection (0 custom rows exist in the live DB — the panel's
  create path is the trigger). Create a badge in `/admin` → Badges with the defaults
  (status "active", no dates), then run `npm run sync:badgebase`; the row comes back
  `expired`, the changelog shows only "1 badges demoted to expired".
- **Suspected cause**: the `source='custom'` protection was added to the global sync only;
  the two later-added sweeps never learned about it.

## B2 — badgebase's "don't sweep on an incident" guard is all-or-nothing, so a partially parsed `/active` listing silently expires redeemable badges
- **Severity**: high
- **Confidence**: medium-high (mechanism certain; needs a partial list to fire — today's list parses 23/23)
- **Where**: `src/lib/syncs/badgebase.ts:111-139` versus `src/lib/syncs/global.ts:118-129`
- **Code**:
  ```ts
  if (activeCards.length === 0 &&
      allBadges.some((row) => row.is_confirmed_active === true)) { ... return { skipped: "empty-listing" } }
  ```
  versus global's ratio guard:
  ```ts
  const suspicious = incomingKeys.size < MIN_INCOMING ||
    (liveExisting > 20 && incomingKeys.size < liveExisting * 0.5);
  ```
- **Why it is wrong**: the guard protects only the *exactly empty* case. `fetchBadgebaseListing`
  is a hand-rolled regex parse (`twitch/badgebase.ts:52-99`) that requires
  `href="/b/<id>-<slug>/"`, a `data-status` attribute inside the `<a>…</a>` block, and that
  `path` be literally `"/active"` or `"/upcoming/"`; any markup drift that makes it parse 1
  of 23 cards passes the guard, and the sweep then computes
  `resolveStatus({..., is_confirmed_active: false})` for the 22 cards it can no longer see:
  every dateless one is demoted to `expired` and its `is_confirmed_active` flag is cleared
  (`:291-300`). Since the listing is documented as *the* authority on redeemable badges
  (AGENTS.md) and the flag "deliberately WINS over an elapsed end date" (`types.ts:137-149`),
  one markup change on a third-party site quietly expires the whole active set. The global
  sync has a proportional guard for exactly this reason; badgebase has none.
- **How to reproduce**: by inspection. Simulate by serving a truncated `/active` (the global
  sync's equivalent incident is blocked by its 50 % ratio check).
- **Suspected cause**: the guard was written against "empty response" only; no ratio/total
  comparison against the previous run or the confirmed-active count.

## B3 — Actively-listed cards beyond the 45-card detail cap never get `is_confirmed_active` (and are never inserted)
- **Severity**: medium
- **Confidence**: high (code path verified; latent — 41 cards today, cap is 45)
- **Where**: `src/lib/syncs/badgebase.ts:79-82`, `:154-224`, `:280`
- **Code**:
  ```ts
  const capped = cards.slice(0, 45);              // cards = [...activeCards, ...upcomingCards]
  const detailed = await mapLimit(capped, 4, (card) => fetchBadgebaseDetail(...));
  ...
  if ((existing.is_confirmed_active as boolean | null) !== confirmedActive) patch.is_confirmed_active = confirmedActive;
  ...
  if (onActiveList) continue;                    // sweep: skips every listed row
  ```
- **Why it is wrong**: `is_confirmed_active` is set **only** inside the `detailed` loop, and
  the sweep explicitly skips every row that is on the active list (`:280`) — it never
  confirms. So an `/active` card at index ≥ 45 is never confirmed: a dateless one stays
  `expired` (`resolveStatus` default) even though badgebase lists it as redeemable right now,
  its dates/how-to-earn stay stale, and if it is unknown to the catalogue it is never
  inserted at all. Because `cards` concatenates active-then-upcoming, a long active list
  starves the `/upcoming` enrichment entirely. Today the two lists are 23 + 18 = 41 cards
  (fetched during this audit), so the cap is not yet reached — it is a growing-catalogue
  cliff, not an active defect.
- **How to reproduce**: by inspection; `cards.slice(0, 45)` is the only detail budget and
  `activeKeys` (from all `activeCards`) is the only confirmation source.
- **Suspected cause**: the detail budget is a politeness cap, but the confirmation flag was
  left dependent on the detail fetch instead of being derived from the listing itself.

## B4 — badgebase forces `status='active'` for a confirmed card regardless of a future start date, contradicting `resolveStatus` and flip-flopping with global/potat
- **Severity**: medium
- **Confidence**: medium (code contradiction certain; no future-dated confirmed card live today)
- **Where**: `src/lib/syncs/badgebase.ts:194-205` and `:244-246` versus `src/lib/twitch/types.ts:137-156`
- **Code**:
  ```ts
  const status = confirmedActive ? "active" : resolveStatus({ start_date: startDate, end_date: endDate, is_confirmed_active: confirmedActive }, now);
  ```
  versus the documented invariant it bypasses:
  ```ts
  // types.ts:149
  if (badge.is_confirmed_active) return startInFuture ? "upcoming" : "active";
  ```
- **Why it is wrong**: `resolveStatus` is the single source of truth for status — its own
  doc says "A confirmed-active badge still only counts as 'upcoming' while its start date
  lies in the future" — and `global.ts:240-252` and `potat.ts:167-178` both call it. Only
  badgebase short-circuits it. For a card that badgebase lists on `/active` while publishing
  a start date in the future (`startDate = detail.startDate ?? card.startTs`), badgebase
  writes `active`, the next global run (daily) and potat run (every 15 min) rewrite it to
  `upcoming`, and the next badgebase run writes `active` again. Each flip increments
  `statusChanged`/`statusSweeps` and can emit a "N badge status transitions" changelog row
  (`global.ts:445-456`); the catalogue alternates between presenting the badge as redeemable
  and as upcoming. This is a cross-surface disagreement of the same fact computed two ways.
- **How to reproduce**: by inspection; grep the live rows for a confirmed-active badge whose
  `start_date` is in the future (currently none).
- **Suspected cause**: the `confirmedActive ? "active"` shortcut predates the future-start
  rule in `resolveStatus`, and the sweep never re-checks rows that are on the active list.

## B5 — One failed `manual/*` sync pins the public `/stats` status gauge to "degraded" indefinitely
- **Severity**: medium
- **Confidence**: high (mechanism verified; latent — no `manual/*` rows in this DB yet)
- **Where**: `src/lib/stats.ts:240-252`, `supabase/migrations/0004_stats_uptime.sql:283-303`, `src/app/api/admin/sync/route.ts:33-42`
- **Code**:
  ```ts
  // stats.ts
  const errored = sources.filter((source) => source.last_status === "error");
  if (errored.length > 0 || ageMinutes > 120) return "degraded";
  ```
  the view it consumes aggregates **every** `system_heartbeats` source (`last_status` =
  `(array_agg(status order by created_at desc))[1]`, grouped by `source`, no filter), and the
  admin button writes sources that nothing else ever writes:
  ```ts
  target === "global" ? await withHeartbeat("manual/global", () => runGlobalSync()) : ...
  ```
- **Why it is wrong**: `manual/global|badgebase|potat` are written only when an operator
  presses "sync now". `withHeartbeat` records `status: "error"` when the run throws
  (`health.ts:75-84`), and no later row ever supersedes it — the scheduled runners write
  `sync/*` and `cron/*`, not `manual/*`. So a single failed troubleshooting run (a provider
  outage during the run, a hung fetch, the `throw` at `badgebase.ts:330-334`) leaves
  `manual/*.last_status = 'error'` forever, and `serviceStatus` returns `degraded` for the
  headline gauge on `/stats` for as long as nobody presses the button again — while the
  scheduled pipeline is perfectly healthy. The same `errored` filter also keeps the gauge at
  `degraded` if the *first* row of any source is an error.
- **How to reproduce**: by inspection; trigger a manual sync while the provider is failing
  and watch `/stats` stay `degraded` after the next successful cron. (No `manual/*` rows
  exist in the live DB — I verified the six sources present are `cron/global`, `cron/potat`,
  `sync/badgebase`, `sync/global`, `sync/potat`, `web`, all `ok` last.)
- **Suspected cause**: `serviceStatus` counts any source's newest row, including
  operator-initiated one-offs that have no recurring writer.

## B6 — The badgebase enrich path is a per-row PATCH/INSERT loop under a 45-fetch budget against a 60 s function limit
- **Severity**: medium
- **Confidence**: medium (arithmetic + the documented `maxDuration`; impact depends on provider latency)
- **Where**: `src/lib/syncs/badgebase.ts:79-82`, `:216-221`, `:228-256`; `src/lib/twitch/badgebase.ts:16-26`; `src/app/api/cron/global/route.ts:8`
- **Code**:
  ```ts
  const capped = cards.slice(0, 45);
  const detailed = await mapLimit(capped, 4, (card) => fetchBadgebaseDetail(...));   // 15 s timeout each
  ...
  const { error } = await supabase.from("badges").update(patch).eq("id", existing.id);   // one round-trip per card
  ...
  const { error } = await supabase.from("badges").upsert({...}, { onConflict: "set_id,version", ignoreDuplicates: true }); // one per card
  ```
  with `export const maxDuration = 60` on the route and `FETCH_TIMEOUT_MS = 15_000`.
- **Why it is wrong**: `AGENTS.md` states the rule explicitly — "per-row PATCH loops would
  exceed the 60 s serverless limit; keep it [bulk upserts] that way" — and this path violates
  it: 45 detail fetches through a 4-worker pool means ~12 sequential rounds, so an average
  detail latency of ~5 s already reaches the 60 s cap before the sweep and the changelog run.
  A slow (not failing) badgebase is enough. Worse, when Vercel kills the invocation at
  `maxDuration`, `withHeartbeat`'s `catch` never executes, so **no heartbeat row is written
  at all**: the run is not `error`, it simply has no row, and `serviceStatus` keeps reporting
  the source's previous `ok` (age only trips it after 36 h). The partial writes that already
  landed (enriched rows, inserts) stay.
- **How to reproduce**: by inspection. Time `mapLimit(capped, 4, …)` against a throttled
  badgebase and compare with `maxDuration`.
- **Suspected cause**: the per-card type needed for the UPDATE path was written before the
  bulk-upsert rule, and nothing bounds the total run.

## B7 — A global-sync failure also skips the whole badgebase drop-window sync for that day
- **Severity**: low-medium
- **Confidence**: high
- **Where**: `src/app/api/cron/global/route.ts:20-38` (returns 500 before line 47)
- **Code**:
  ```ts
  try { summary = await withHeartbeat("sync/global", () => runGlobalSync()); }
  catch (error) { ... await pruneHeartbeats(90); await recordHeartbeat({ source: "cron/global", status: "error", ... });
    return Response.json({...}, { status: 500 }); }
  // badgebase enrichment starts here (line 43-69) — unreachable
  ```
- **Why it is wrong**: the two engines were merged into one handler because the Hobby plan
  allows two crons, and the prune was moved out of the early return (cron-3) — but the
  badgebase enrichment still is not. `runGlobalSync` throws on any provider incident (its own
  guard at `global.ts:125-129` throws by design) and on any Supabase error, so a single bad
  morning for the IVR/Helix feed freezes `is_confirmed_active`, countdown end dates and
  how-to-earn text for the whole day, even though badgebase itself is reachable — the
  authoritative activity source is skipped as collateral damage.
- **How to reproduce**: by inspection; make `fetchGlobalBadgeCatalog` throw and call
  `/api/cron/global`.
- **Suspected cause**: the early return predates the two engines sharing one route.

## B8 — Leftover scratch script in `scripts/` grants the `owner` role to a hardcoded account
- **Severity**: medium-high (privilege escalation, dead code committed next to working scripts)
- **Confidence**: high
- **Where**: `scripts/_tmp-role2.mjs:1-7`
- **Code**:
  ```js
  import { config } from "dotenv"; config({ path: ".env.local" });
  import postgres from "postgres";
  const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: "prefer", max: 1 });
  await sql`update profiles set role = 'owner' where username = 'band1to'`;
  ```
- **Why it is wrong**: a `_tmp-` prefixed one-off is still a runnable script in the repo that
  connects with the service-role credentials from `.env.local` and promotes a hardcoded
  account to `owner` — the highest admin rank (the earlier admin round hardened exactly this
  field: "the `profiles.role` guard"). Anyone who runs `node scripts/_tmp-role2.mjs` (or a
  future `npm run` glob over `scripts/*.mjs`) silently mints an owner. It also documents the
  maintenance shortcut in the source tree rather than in a migration or the audit log.
- **How to reproduce**: it is self-executing on import; `node scripts/_tmp-role2.mjs`.
- **Suspected cause**: a scratch script left behind after a role probe.

## B9 — Unpaginated `select("*")` in both sweeps silently stops at PostgREST's 1000-row default
- **Severity**: low
- **Confidence**: medium (mechanism certain; latent at 476 rows)
- **Where**: `src/lib/syncs/badgebase.ts:84-90`, `src/lib/syncs/potat.ts:82-102`
- **Code**:
  ```ts
  const allBadges = await supabase.from("badges").select("*").then(({ data, error }) => { ... });
  ```
- **Why it is wrong**: `global.ts` pages its catalogue load in 1000-row steps (`:58-69`), the
  other two do not. Past 1000 catalogue rows, `allBadges`/`badges` are the first 1000 rows
  only: the badgebase sweep can no longer demote, resurrect or clear `is_confirmed_active`
  for the remainder, and the potat sync never refreshes their owner counts or rarity — with
  no error, no truncation flag and no heartbeat difference. This is a different surface from
  the already-reported pdat-7/pdat-8 (which are the `/stats` views and `queries.ts`): here the
  *writer* silently gains a blind spot, so the rows beyond the cap keep whatever stale state
  they had. At 476 rows it is inert.
- **How to reproduce**: by inspection; the request carries no `.range()`/`.limit()`.
- **Suspected cause**: the paginated loader pattern was applied to `global.ts` only.

## B10 — The new-badge fan-out ignores lookup/insert errors and still pushes a notification with an empty link
- **Severity**: low
- **Confidence**: medium
- **Where**: `src/lib/syncs/global.ts:319-327`, `:345-351`, `:391-393`, `:428-434`
- **Code**:
  ```ts
  const { data } = await supabase.from("badges").select("id,slug,title,...").in("slug", batch);  // error dropped
  ...
  await supabase.from("badge_events").insert(freshRows.map(...));                                 // error dropped
  ...
  const url = `/en/badges/${first?.slug ?? ""}`;                                                 // "" when freshRows is empty
  await recordNotification({ ... url ... });
  await sendPushToAll({ ... url ... });
  ```
- **Why it is wrong**: `freshRows` comes from a select whose `error` is discarded. If it fails
  (transient 5xx, statement timeout under load) `freshRows` is empty, so the `badge_events`
  history insert and every `createDropPost` are silently skipped, while the `badge_added`
  changelog row, the desktop notification and the web-push blast still go out — with
  `url: "/en/badges/"` (the fallback of `first?.slug ?? ""`), a dead link delivered to every
  subscriber. Same shape at `:428` for the removal events. The history and the blog are the
  durable record of a drop, so losing them is silent data loss.
- **How to reproduce**: by inspection; make the `.in("slug", …)` select fail and call
  `runGlobalSync()` with one new badge.
- **Suspected cause**: reads that feed the fan-out were written without error handling
  because they "cannot fail" in practice.

## B11 — `inserted` counts badgebase upserts that `ignoreDuplicates` discarded
- **Severity**: low
- **Confidence**: low (the counter is wrong; I did not construct a case where the lookup misses)
- **Where**: `src/lib/syncs/badgebase.ts:228-255`
- **Code**:
  ```ts
  const { error } = await supabase.from("badges").upsert({ ... }, { onConflict: "set_id,version", ignoreDuplicates: true });
  if (error) throw error;
  inserted += 1;
  ```
- **Why it is wrong**: `ignoreDuplicates: true` makes a conflicting row a silent no-op, yet the
  counter is incremented unconditionally — so the `data_sync` changelog ("N new badges
  inserted") and the returned summary overstate. This is reachable whenever the
  `existing` lookup at `:159-161` misses a row that the `(set_id,version)` arbiter then finds
  — i.e. a catalogue row that carries the badge's badgebase slug but whose image UUID
  extraction failed (`imageUuid` null / a non-`badges/v1/<uuid>` URL). The card is then never
  enriched either (the enrich branch was skipped), so both the count and the data are off.
- **How to reproduce**: by inspection; construct a card whose `imageUuid` is null and whose
  slug is already a `set_id` in the catalogue.
- **Suspected cause**: the counter was treated as "the loop ran" rather than "the insert
  happened"; `ignoreDuplicates` has no affected-row signal here.

---

## Checked and found sound (so that "nothing" means something)

- **Cron authorization**: all three routes call `isAuthorizedCron` first
  (`cron/global:11`, `cron/potat:9`, `cron/badgebase:9`); `cron-auth.ts:12-20` compares
  SHA-256 digests of equal length with `timingSafeEqual` and fails closed when `CRON_SECRET`
  is unset. `vercel.json` schedules only `/api/cron/global` (06:00) and `/api/cron/potat`
  (06:30) — matches AGENTS.md, no sub-daily Vercel schedule. The Actions workflow uses
  `concurrency: cancel-in-progress: false` and `set -euo pipefail`, and its
  `test "$status" = "200"` fails the job on 401/500, so an auth regression is loud.
- **Single-flight identity matching**: `global.ts` matches on `(set_id, version)` and
  additionally on the badge image UUID for the removal sweep (`:102-106`, `:274-277`); the
  badgebase sync matches `byUuid` first then `bySetId` (`:159-161`); potat matches
  `(badge, version)` then the URL UUID (`:136-139`). `badgeSlug` is deterministic and I
  verified against the live table that **no** row's stored slug differs from
  `badgeSlug(set_id, version)` and that **no two rows would collide** under it (0 of 476),
  and no `set_id` contains characters that normalise (0 non-`[a-z0-9_-]` set ids) — so the
  `slug text not null unique` constraint (`0001_init.sql:63`) is not reachable by
  normalisation drift today.
- **Duplicate catalogue entries**: grouping the 476 rows by extracted image UUID found only
  two multi-row UUIDs — `twitchconAmsterdam2020`/`twitchconNA2020` (different sets sharing
  artwork) and two versions of `subscriber` — so the badgebase insert path is not creating
  shadow rows for badges the global sync already holds.
- **No wrongly-expired active rows today**: exactly one non-confirmed `active` row exists
  (`harley-mayhem`, start 2026-09-01, no end date), which `resolveStatus` keeps active
  through its window; the 23 confirmed rows match the 23 `/active` cards badgebase currently
  serves.
- **`resolveStatus` precedence** (`types.ts:137-156`) is internally consistent and correctly
  prefers `is_confirmed_active` over an elapsed `end_date`, keeps a future start as
  `upcoming`, and treats dateless/unconfirmed as `expired`; `data-reset` is not read anywhere
  in `src/`; `isStatusSetId` and the `category='status'` rule in `guessCategory` list the same
  tokens (so the delete at `global.ts:133-138` cannot churn non-status rows), and
  `admin-content.ts:302-307` rejects `category='status'` on both create and update.
- **Batching/DEFAULT handling**: `global.ts` keeps new and existing rows in separate batches
  with homogeneous key sets (`:187-262`), `badgebase.ts` spreads full `select("*")` rows
  (`:272-276`), `potat.ts` collapses pending upserts by `(set_id,version)` before chunking
  (`:219-222`); all three upsert on the real `unique (set_id, version)` arbiter. The single
  remaining hole (global's lack of a duplicate-key collapse) is pdat-6, already open and
  inert.
- **cron/potat and cron/badgebase** return 500 + an `error` heartbeat exactly when the engine
  throws, and 200 + `degraded` for a deliberate skip (`potat:17-31`, `badgebase:29-51`);
  `withHeartbeat` never lets a heartbeat write break the caller (`health.ts:30-44`) and its
  `errorMessage` handles non-`Error` objects (`:92-111`).
- **`mapLimit`** (`badgebase.ts:33-56`) is safe: the cursor increment sits in the same
  synchronous tick as the read, as required on a single JS thread.
- **Scripts**: `db-log-change.ts`/`log-change.ts` validate `kind` and JSON before touching the
  DB; `db-apply.ts` now wraps each migration and its ledger row in `tx.begin` (cron-4 fixed);
  `sync-global|badgebase|potat.ts` use `config()` + dynamic `import()` and no top-level await
  as AGENTS.md requires; `send-push.ts` refuses to run without VAPID keys.