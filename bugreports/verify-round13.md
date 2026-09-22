# Round 13 verification — `5799ec3` (the batch-column-union fix) and the docs commit

Date: 2026-09-22. Agent: verification. Scope: `git show 5799ec3` (the high-severity
global-sync fix) plus the files it touched (`src/lib/syncs/global.ts`,
`src/lib/syncs/badgebase.ts`, `src/lib/inventory.ts`, `src/app/sitemap.ts`,
`src/lib/gamification/session.ts`), and the writers that share the same shape
(`src/lib/syncs/potat.ts`). Round-12 items already fixed or already on the open
list (`bugreports/AGENT-AUDIT.md`) are not re-reported.

Nothing was edited except this report. No secret was printed.

---

## Findings

### v13-01 — the relocated empty-listing guard landed *inside* the catalog loop (medium, server)

**File:** `src/lib/syncs/badgebase.ts:92` (the loop), `:97-108` (the guard), `:109-110` (loop tail)
**New in this commit:** yes — `46c89ab` had it as a top-level statement before `cards` was built;
`5799ec3` moved it and the new placement is inside the loop body.

**Evidence** (current file, verbatim structure):

```ts
  for (const row of allBadges) {                       // :92
    const uuid = extractUuid(row.image_url_1x ...) ?? ...;
    if (uuid) byUuid.set(uuid, row);                   // :95

  // ... "Placed after the catalog load ... and still before every write."   :97-101
  if (activeCards.length === 0 && [...byUuid.values(), ...bySetId.values()].some(   // :102
    (row) => row.is_confirmed_active === true,
  )) {
    throw new Error("drop-window listing is empty while confirmed-active badges exist - ...");
  }                                                    // :108
    if (!bySetId.has(row.set_id as string)) bySetId.set(row.set_id as string, row); // :109
  }                                                    // :110
```

The block sits between `byUuid.set` (line 95) and the `bySetId.set` that fills the second
half of the index (line 109), i.e. **inside** `for (const row of allBadges)`. The commit
message and the block's own comment both claim it was "placed after the catalog load".

**Why it is a bug.** The predicate reads `byUuid`/`bySetId`, which are built by the same loop:

1. If `allBadges` is empty the body never runs, so the guard is **never evaluated at all**
   (in that state there is nothing to demote, so this alone is harmless).
2. At iteration *i* the check sees only rows `0..i` (plus `byUuid` for row *i*) — not "the
   catalog has confirmed-active rows" but "a prefix of the catalog does". The final row's
   `bySetId` entry is written **after** the last guard evaluation and is therefore only
   visible if that row has an extractable badge UUID. Any row that (a) has no badge UUID in
   `image_url_1x/2x` **and** (b) is not the first row of its `set_id` is never in either map
   at the moment of a check, so a confirmed-active row of that shape cannot trip the guard.
3. It is evaluated once per catalog row (476 today) and allocates two arrays per iteration.

The guard is a data-loss brake (it is what stops an empty `/active` listing from clearing
every confirmation and demoting the whole catalog), so a partially-populated predicate is
the wrong shape for it.

**Confidence:** high for the misplacement and for "the predicate is evaluated against a
partially built index". The full bypass (2) is order-dependent and **unconfirmed against
live data**: all 476 current rows carry a `/badges/v1/<uuid>` URL, so by the last iteration
the guard has effectively seen the whole catalog and a non-empty `/active` (21 cards today)
short-circuits it anyway.

**Fix direction:** move the block out of the loop — a standalone statement after line 110,
before `const now = new Date()` (line 112) — which is exactly what the comment describes.

---

### v13-02 — every sync failure is recorded, and shown on `/stats`, as `"[object Object]"` (medium, server)

**Files:** `src/lib/health.ts:68`; the throwing sites it wraps, e.g.
`src/lib/syncs/global.ts:229`, `:235`, `:250`, `:107`; `src/lib/syncs/badgebase.ts:196`,
`:230`, `:282`; `src/lib/syncs/potat.ts:228`, `:233`.

**Evidence.** `health.ts:68` is

```ts
message: error instanceof Error ? error.message : String(error),
```

and the syncs throw the PostgREST error object directly (`if (error) throw error`). With the
installed client (`@supabase/postgrest-js` 2.116.0) that object is **not** an `Error`:

```
error type        : object | instanceOf Error: false | ctor: Object
String(error)     : [object Object]
error.message     : null value in column "slug" of relation "badges" violates not-null constraint
error.code        : 23502
```

(measured this round with a deliberately failing insert — `slug: null` — which wrote no row;
`did not print any secret`; the probe left no row: `badges?set_id=eq.verify-probe -> */0`.)

Live rows prove it in production — the two failures this very commit fixed are stored as:

```
{"source":"sync/global","status":"error","message":"[object Object]","created_at":"2026-09-22T11:25:34Z"}
{"source":"sync/global","status":"error","message":"[object Object]","created_at":"2026-09-22T11:21:49Z"}
```

(the fix's changelog row is `created_at 11:29:52`, i.e. these are the runs it was fixing).

**Why it is a bug.** `AGENTS.md` calls `system_heartbeats` "the single source of truth for
uptime", and `0004_stats_uptime.sql:299` aggregates
`(array_agg(message order by created_at desc))[1] as last_message`, declared at
`src/lib/stats.ts:175` and rendered on the public stats page —
`src/app/[locale]/stats/page.tsx:1060-1066` prints `source.last_message.slice(0, 40)` with the
full string as its tooltip. So the only trace of a sync outage — including the one that had
silently stopped the catalog from growing — is the string `[object Object]`, shown to visitors.
The author only knew the real message because `console.error` in the script inspects the object.

**Confidence:** high (runtime probe plus two live rows).
**Fix direction:** unwrap the object in `health.ts`
(`error instanceof Error ? error.message : (error as {message?: string})?.message ?? JSON.stringify(error)`),
or throw `new Error(error.message)` at the sync sites so the PostgREST code/hint survives.

---

### v13-03 — the global sync's `updated` count and its changelog entry come from a daily ping-pong with the badgebase sync (medium, server)

**Files:** `src/lib/syncs/global.ts:170-185` (the `fieldChanged` comparison), `:205-207` (the
full-row write-back), `:360-370` (the `badge_updated` changelog row) vs
`src/lib/syncs/badgebase.ts:161-166` (writes `description` from the detail page).

**Evidence (three consecutive real runs, this round).**

| run | summary |
|---|---|
| `sync-global` (1st) | `source ivr, versions 476, added 0, updated 41, removed 0, statusChanged 0` |
| `sync-global` (2nd, immediately after) | `... updated 0 ...` |
| `sync-badgebase` | `activeCards 21, upcomingCards 20, enriched 41, inserted 0, demotedToExpired 0, errors 0` |
| `sync-global` (3rd, immediately after) | `... updated 41 ...` |
| `sync-badgebase` (2nd) | `enriched 41 ... errors 0` |

The `updated` counter flipped 0 → 41 purely because a badgebase run happened in between, twice,
with the same count. `changelog` gained `{"kind":"badge_updated","title":"41 badges updated"}`
after *each* global run that followed a badgebase run (ids 270 and 274; the commit's own run
produced the same row at id 266, `"27 badges updated"`).

**Why it is a bug.** The global sync compares exactly six fields
(`global.ts:170-176`: title, description, image_url_1x/2x/4x, click_url). For an *existing*
row badgebase's patch can only write one of them — `description` (`badgebase.ts:159-166`;
its other keys are `start_date`, `end_date`, `release_date`, `is_paid`, `how_to_earn`,
`is_confirmed_active`, `status`, `removed_at`). So the two syncs overwrite each other's
description on the same ~41 rows on every cycle: the global run finds them "changed", rewrites
`description` from the IVR feed (possibly null), counts them as `updated`, and publishes
`N badges updated` on `/changelog` and its RSS feed — a public "data changed" entry for a
change that is not real. In production `/api/cron/global` runs `runGlobalSync()` **then**
`runBadgebaseSync()`, so this repeats every day at 06:00 UTC.

Note this also undercuts the commit message: `updated 27` is cited there as evidence of a
healthy run, but a nonzero `updated` is the normal artifact of this loop, not a refresh.

**Confidence:** high for the count correlation and the changelog consequence (five measured
runs, live changelog rows). The identification of `description` as the fighting column is a
code-level deduction (it is the only badgebase-written field that appears in the comparison);
I did not diff the per-row column, so that one step is **deduced, not directly observed**.

**Fix direction:** make one source authoritative (drop `description` from the global
comparison/patch, or exclude it from `fieldChanged` and let the detail-page text win), and
only batch rows whose patch actually changes something.

---

### v13-04 — the global catalog loader still pages without `ORDER BY`, the exact defect v12-03 fixed elsewhere (low, server)

**File:** `src/lib/syncs/global.ts:57-67` — `.select("*")` (line 60) + `.range(offset, offset + 999)`
(line 61), no `.order(...)`.

**Evidence.** The same commit added `.order("id")` to the other two paged loaders —
`src/lib/inventory.ts:39` and `src/app/sitemap.ts:46` and `:60` — and `v12-03` in
`AGENT-AUDIT.md` is recorded as "the new paging loops had no ORDER BY … both order by `id`".
The loader in the file the commit was fixing was left unordered.

**Why it is a bug (latent).** `OFFSET`/`LIMIT` without a stable sort is non-deterministic once
more than one page is returned. A row skipped between pages is absent from `existing`, so the
sync treats a pre-existing badge as new: it goes into `upsertsNew` with `first_seen_at = now()`
(line 160), is counted in `addedTitles`/`newSlugs`, and the fan-out at `:258-357` writes a
duplicate `badge_events('added')` row, an auto blog post (`createDropPost`) and a push
notification for a badge that is not new — the same visible failure class as the already-fixed
`sync-1`. Conversely a *duplicated* row would be collapsed by the map, so the risk is skew, not
a crash.

**Consequence today:** none observable — the catalog is 476 rows, so the first page returns
`data.length < 1000` and the loop breaks after one query. **Confidence:** high on the code,
latent on impact (cannot be demonstrated at 476 rows).

Same class, also unordered/unpaged: `src/lib/syncs/badgebase.ts:82-88` and
`src/lib/syncs/potat.ts:82-85` both do `.select("*")` with no `.range(...)`, so the sweep/stat
pass silently stops at PostgREST's 1000-row default. (Partly covered by the open `pdat-7`/
`pdat-8` entries; noted here as the same defect family rather than a new item.)

**Fix direction:** `.order("id")` on `global.ts:61` (and `.range()` paging in badgebase/potat).

---

### v13-05 — the full-row write-back reverts concurrent writes and stamps `updated_at` on the whole catalog every run (low, server)

**File:** `src/lib/syncs/global.ts:205-207` (`const { id: _existingId, ...existingWithoutId } = ex;`
then `{ ...existingWithoutId, ...patch }`), read at `:57-67`, written at `:231-236`.
**Pre-existing:** the pre-fix code spread the same columns (plus `id`), so this commit neither
introduced nor removed it — it is the "row read at the start of the run is rewritten at the end"
class the brief asked about.

**(a) Columns a concurrent writer can have its changes reverted.** The only concurrent writer to
`badges` is the potat sync (every 15 min via GitHub Actions, including 06:00 UTC — the same
minute as the daily global cron; badgebase runs *after* global inside the same request, so it
cannot overlap). Potat writes `owner_count`, `active_count`, `percentage`, `last_polled_at`,
`rarity_score`, `rarity_tier`, `status` (`potat.ts:189-198`). All seven are inside
`existingWithoutId`, so a potat write landing between global's load and global's write is
reverted to the snapshot value. `status` converges anyway (both sides call `resolveStatus` on the
same fields, `:187-199`), so the real loss is ≤15 min of staleness on the six statistic columns,
self-healed by the next potat run. `start_date`/`end_date` are also written back (global never
intends to change them) but only a concurrent *badgebase* run could be clobbered, which the cron
ordering prevents.

**(b) Measured consequence — `updated_at` churn.** `patch` always carries `last_seen_at`
(`:169`), so every existing row is written on every run, and the `BEFORE UPDATE` trigger
`badges_touch_updated` (`0001_init.sql:299-301`, `new.updated_at = now()`) therefore bumps the
whole catalog:

```
updated_at >= 2026-09-22T11:27:00Z : 476 / 476     (only 41 had any content difference)
```

That makes `updated_at` a "last synced" stamp: every badge URL's sitemap `lastModified`
(`src/app/sitemap.ts:81-84`) and the "newest catalog timestamp" that all static entries use
(`:65-68`) claim the whole site changed on every daily sync — the behaviour the `seo-3` fix
explicitly set out to eliminate.

**Confidence:** high (trigger + live `updated_at` distribution; potat's write set read from code).
**Fix direction:** batch only rows whose patch has a real change (e.g. keep `last_seen_at` out of
the upsert and update it with a narrow statement, or skip the row entirely when `patch` carries
nothing but `last_seen_at`), and never write `updated_at`.

---

### v13-06 — the provider guard counts raw feed entries, not distinct badges (low, server)

**File:** `src/lib/syncs/global.ts:87-98` vs the de-duplicated set built at `:70`
(`incomingKeys`), which is what the sweep at `:212-223` actually uses.

**Evidence.**

```ts
const suspicious =
  incoming.length < MIN_INCOMING ||
  (liveExisting > 20 && incoming.length < liveExisting * 0.5);   // :91-93
```

`v12-01` fixed the denominator to count only rows the sweep can act on (`liveExisting`,
`:88-90`); the numerator still counts feed *entries*, including repeats of the same
`set_id:version`.

**Why it is a bug.** A feed that repeats one badge holds `incoming.length` above the threshold
while carrying almost none of the catalog. With 476 live rows, a response containing the same
badge 300 times passes the guard (`300 ≥ 238`) while `incomingKeys` has a single element, so the
other ~475 live badges fail the `incomingKeys.has(key)` test at `:213`, their UUIDs are not in
`incomingUuids`, and every one of them is swept to `status = 'removed'` — the mass deletion the
guard exists to prevent. The guard is therefore bypassable by a *duplicating* provider fault
rather than a truncating one.

**Confidence:** high for the logic; the exploit path is **unconfirmed** — no duplicated feed has
been observed (the live feed yields 476 distinct keys and the guard has never tripped).
**Fix direction:** make the ratio compare `incomingKeys.size`, keeping `incoming.length` only for
the `MIN_INCOMING` floor.

---

## Areas checked and found clean

**Item 1 — the two batches never mix, and each is internally homogeneous.** Confirmed.
`upsertsNew` rows are all built from the same object literal (`global.ts:146-162`), so their key
set is identical. `upsertsExisting` rows are `{ ...existingWithoutId, ...patch }` where
`existingWithoutId` comes from `.select("*")` (`:60`), so every row already carries the full
column set and the per-row `patch` keys (`:170-199`) are a subset of columns that are already
present — the key set is therefore identical for every row even though `patch` varies. The two
batches are issued separately (`:225-230`, `:231-236`).

- **Every NOT NULL column is satisfied.** `0001_init.sql:59-92`: `set_id`, `version`, `slug`,
  `title` are provided explicitly; `category`, `is_paid`, `status`, `first_seen_at`,
  `last_seen_at`, `source` are provided; `rarity_score`/`rarity_tier` and
  `is_confirmed_active` (`0002_status_rarity_potat.sql:10`, NOT NULL DEFAULT false) are omitted
  but all have defaults, so a pure INSERT is valid, and PostgREST's `ON CONFLICT ... DO UPDATE`
  only assigns the columns present in the payload, so an omitted column on a conflicting row is
  preserved rather than nulled. Verified by the real runs below (`added 0`, exit 0).
- **The conflict keys survive in the existing batch.** `existingWithoutId` contains both
  `set_id` and `version` (only `id` is dropped), and `badges` has
  `unique (set_id, version)` (`0001_init.sql:92`), so the `onConflict: "set_id,version"`
  arbiter still identifies the row. Dropping `id` is therefore not only legal but safer than
  sending it: it removes any chance of an explicit-PK insert path.

**Item 2 — no other writer has the mixed-shape defect.** Checked every multi-row
`.insert(`/`.upsert(` in `src/` and `scripts/`:

- `badgebase.ts:236-283` (`sweepRows`) spreads a full `select("*")` row (`{...row, ...}`) —
  homogeneous within the batch, and the `id` it carries is the row's own, written back to
  itself through the `(set_id,version)` arbiter.
- `potat.ts:189-198` (`{ ...badge, ... }`) — same: full row, identical key set for every row,
  `id` unchanged. This is the closest analogue to the fixed defect and it is *not* the same
  defect (no batch mixes shapes). Potat is the production proof it works: it runs every 15 min
  and reports success. (The theoretical "insert proposes an existing PK while the arbiter is a
  different unique key" edge is not exercised, and I did not run potat per the brief's scope —
  marked unconfirmed but empirically fine.)
- `inventory.ts:92-98` — `toAdd.map(...)` produces identical 3-key objects; deduped against
  `currentIds` before the insert.
- `push/subscribe/route.ts:71`, `blog.ts:30`, `blog.ts:80`, `xp.ts:96`, `xp.ts:137`,
  `inventory.ts:138` — all single-object upserts with fixed shapes.
- `global.ts:289` and `:372` — `badge_events` inserts from `.map()`, homogeneous.

**Item 3** — assessed, see v13-05.

**Item 4 — the guard precedes every write in `runGlobalSync`.** Confirmed by enumerating the
function: `fetchGlobalBadgeCatalog` (`:50`) and the catalog load (`:57-67`) are reads; the guard
is `:87-98`; every write is after it — the status cleanup DELETE (`:102-107`), the two upserts
(`:225-236`), the removal sweep (`:238-252`), `badge_events` (`:289`, `:372`), `createDropPost`
(`:298`), `logChange` (`:318`, `:361`, `:379`, `:391`, `:402`), `recordNotification`/`sendPushToAll`
(`:338`, `:348`). Same for `runBadgebaseSync`: all writes (`:192`, `:204`, `:281`, `:285`) are
after its guard. The *counting* weakness of the guard is v13-06; the placement weakness is
v13-01.

**Item 5 — the round-12 changes to badgebase/potat are otherwise correct and cannot block a
legitimate run.** `ownersOk = ok && rows.length > 0` (`potat.ts:57`) is the right direction
(an empty-but-resolving owners feed keeps the stored counts instead of nulling them) and does not
block anything — the sync completes and reports `ownersFeedOk`. The `.order("id")` additions
(`inventory.ts:39`, `sitemap.ts:46`, `:60`) are correct and sufficient (`id` is a unique PK, so it
is a total order); ordering by a column that is not in the select list is valid PostgREST.
The badgebase guard's *condition* is also right: with 21 confirmed-active rows it does not false-
positive (`/active` returned 21 cards in both of my runs, `errors 0`). Residual design note (not
a bug): if `/active` ever legitimately empties, the sync will refuse every day and there is no
path — other than a manual intervention — that clears `is_confirmed_active`; that is the
trade-off v12-05 chose deliberately (fail loudly instead of wiping).

**Also checked, latent only:** `guessCategory`'s `status` rule (`types.ts:161`) lacks the
`([-_]|$)` boundary that `isStatusSetId` requires (`types.ts:186`), so a set_id beginning with
one of those words but not followed by `-`/`_` would be classified `category='status'` while
still being admitted to the catalog — and the next run's cleanup (`global.ts:102-107`) would
delete it, producing an insert/delete cycle plus a spurious `badge_removed` changelog row. No
such set_id exists today: over the live catalog, `guessCategory=status but isStatusSetId=false`
= **0 of 476**. Pre-existing, unreachable in current data, so listed here rather than as a finding.

**Confirmed as already-open (not re-reported):** `pdat-6` (duplicate rows in one upsert batch →
PG 21000). `potat.ts:219-222` dedupes by `(set_id,version)` before batching, but `global.ts`'s
two batches have no such collapse, and `incomingKeys` proves the feed can in principle contain a
repeated key. Live catalog has **0** duplicate `(set_id,version)` pairs, so today it is inert.

---

## Real syncs run (item 6) — exact summaries

Run because they are the documented daily production operations and are idempotent; `added`
was expected to be 0 after `rematch-blue-lock` was inserted.

```
$ npx tsx scripts/sync-global.ts      # 11:45:01Z
[sync:global] { "source": "ivr", "versions": 476, "added": 0, "updated": 41,
                "removed": 0, "statusChanged": 0, "addedTitles": [] }
$ npx tsx scripts/sync-global.ts      # 11:45:57Z
[sync:global] { "source": "ivr", "versions": 476, "added": 0, "updated": 0,
                "removed": 0, "statusChanged": 0, "addedTitles": [] }
$ npx tsx scripts/sync-badgebase.ts   # 11:47Z
[sync:badgebase] { "activeCards": 21, "upcomingCards": 20, "enriched": 41,
                   "inserted": 0, "demotedToExpired": 0, "errors": 0 }
$ npx tsx scripts/sync-global.ts      # 11:47:47Z
[sync:global] { "source": "ivr", "versions": 476, "added": 0, "updated": 41,
                "removed": 0, "statusChanged": 0, "addedTitles": [] }
$ npx tsx scripts/sync-badgebase.ts   # 11:53Z  (final, restores the cron's own end state)
[sync:badgebase] { "activeCards": 21, "upcomingCards": 20, "enriched": 41,
                   "inserted": 0, "demotedToExpired": 0, "errors": 0 }
```

All five exited 0. `added: 0` in every global run as predicted, so the two-batch fix works (the
real global cron run recorded in the changelog at 11:27:01 was `added 1, updated 27, removed 0`
and produced `rematch-blue-lock-v1`, 475 → 476 versions; the catalog still holds 476 and the
badge is present with `status "upcoming"`).

**Production deltas from my runs** (disclosed): 7 `changelog` rows (269 → 276: three
`Catalog sync completed`, two `badge_updated "41 badges updated"`, two `Drop-window listing sync
completed`) and 5 `system_heartbeats` rows. `last_seen_at`/`updated_at` were touched on all rows
by design of the sync. No badge row was created or deleted; the final state matches the state the
daily cron leaves (badgebase ran last), and the pre/post invariants are unchanged:
`badges = 476`, `status=removed = 0`, `category=status = 0`, `is_confirmed_active = 21`. The one
stray write probe (`slug: null`) failed on a NOT NULL constraint and left no row.