# Verification round 12 — the server-side half of `46c89ab` / `3ee3002`

Scope: the eight server-side changes named in the brief, the two commits
(`46c89ab` fixes, `3ee3002` docs). Read-only: no project file was edited; the
database was touched only inside transactions that were ROLLED BACK.

Environment note (affects the outstanding test): the session pooler on port
**5432** is currently unreachable from this machine (TCP opens, the pg handshake
times out), while the transaction pooler on **6543** with the same credentials
works. The runtime test below therefore ran over 6543. `PGHOST:5432` may need
re-checking the next time `npm run db:apply` runs here.

State at the time of writing (read live over 6543): 475 badges — 433 `expired`,
23 `active`, 19 `upcoming`, **0 `removed`**; 25 published blog posts; 1 profile;
1 `user_progress` row; 0 `coin_rain_gate` rows. `sitemap.xml` returns **5 808**
URLs, which matches 475 badges × 11 locales + 25 posts × 11 + 15 static paths × 11
+ 13 games × 11 exactly.

---

## v12-01 — the global-sync guard divides by a denominator that includes `removed` rows no code ever deletes, so it tightens monotonically and can permanently block every global sync

- **Severity**: medium (latent today, deterministic once removals accumulate)
- **Side**: server / sync / availability
- **File:line**:
  - `src/lib/syncs/global.ts:75-86` — `existing` is loaded with `.select("*")` and
    **no status filter**, so every `status = 'removed'` row is in the map
  - `src/lib/syncs/global.ts:190-203` — the sweep explicitly skips
    `ex.status === "removed"` and nothing ever deletes those rows
  - `src/lib/syncs/global.ts:101-109` — the guard requires
    `incoming.length >= existing.size * 0.5`
- **Evidence**: the guard's own message ("against `${existing.size}` known")
  treats `existing` as the size of the live catalog, but the map holds every row
  the table has ever had, because a removed badge is flagged, never deleted
  (`:193` `if (incomingKeys.has(key) || ex.status === "removed") continue;`).
  Today the two coincide — the live sync history
  (`changelog`, `kind='data_sync'`) reads `versions=475` for `existing.size=475`
  and the by-status count above is `removed: 0`, so the ratio is `1.0` and passes.
  But `existing.size` is `live + removed`, and `removed` only grows. The guard
  trips as soon as `incoming < 0.5 · (live + removed)`, i.e. roughly once the
  accumulated removals exceed the current live count — and from that run on every
  global sync throws, so the removal sweep it was meant to protect never runs
  again and the condition only ever worsens.
- **Why it is a bug**: the fix for srv-1 (an empty/truncated feed wiping the
  catalog) was implemented against the wrong baseline. The pre-fix report
  (`verify-server.md`, srv-1) suggested `incoming.length === 0`; the shipped
  check widened it to a 50 %-of-catalog rule whose denominator is unbounded, so
  it converts a transient provider incident into a permanent outage of the
  catalog sync once enough historical badges have been retired.
- **Confidence**: high on the mechanism (pure code reading plus the live
  `removed: 0` measurement proving it is latent, not active today). The exact
  point at which it fires depends on how fast Twitch retires global badges.
- **Fix direction**: compare against the count of **non-removed** rows, or better
  against the previous run's `versions` (already persisted in the
  `data_sync` changelog payload), e.g. keep a `live` counter while loading and
  gate on `incoming.length < live * 0.5`. A short comment should state that
  `existing` intentionally includes removed rows for the sweep, so the guard must
  not reuse its size as the live baseline.

---

## v12-02 — the guard does not sit before *all* writes: the status-badge delete and its changelog row already ran

- **Severity**: low (informational; no data-loss path)
- **Side**: server / sync / ordering
- **File:line**: `src/lib/syncs/global.ts:57-72` (delete + `logChange`) versus the
  guard at `:101-109`
- **Evidence**: the commit message says the sync "refuses before any write". It
  refuses before the destructive half (the upserts at `:205`, the `removed`
  update at `:212-226`, the `badge_events` inserts and the blog/push fan-out at
  `:228-332`) — that part is correct and is what matters for srv-1. But the
  `delete().eq("category","status")` and its `logChange` run *before* the guard,
  so on an aborted run the catalog can already have lost rows and gained a
  changelog entry.
- **Why it is a bug**: only that the stated invariant is inaccurate. The pre-guard
  write is idempotent, independent of the provider feed, and would happen on a
  healthy run anyway, so there is no incorrect state — but a reader trusting the
  comment would believe nothing is written on refusal.
- **Confidence**: high.
- **Fix direction**: either move the status-badge cleanup after the guard, or
  correct the comment to say "before any feed-derived write".

---

## v12-03 — the two new paged loops have no `ORDER BY`, so OFFSET/LIMIT paging is non-deterministic

- **Severity**: low (latent; today both tables fit in one page)
- **Side**: server / sitemap + inventory
- **File:line**:
  - `src/app/sitemap.ts:41-50` and `:51-60`
  - `src/lib/inventory.ts:34-53`
- **Evidence**: srv-6 replaced a single capped select with
  `.range(offset, offset + PAGE - 1)` loops, but no loop adds an `.order(...)`.
  PostgREST returns rows in whatever order the planner produces unless `order` is
  given, and OFFSET/LIMIT over an unordered result is not stable across the
  separate requests each page issues. A write landing between two pages (the
  global/potat crons run against the same table) or physical row movement can
  therefore shift the window: a row can be returned twice or skipped.
  Currently the catalog is 475 rows and there are 25 posts, each below `PAGE`,
  so every loop issues exactly one request and the risk is latent.
- **Why it is a bug**: the inventory consequence is not merely cosmetic — a badge
  skipped by an unstable page is counted as `unmatched` (`inventory.ts:57-64`),
  so if the user already owns it the row falls into `toRemove` and is **deleted**
  from `user_inventory` (`:100-107`). In the sitemap a skipped badge silently
  drops URLs (and a duplicate emits one), which is the exact failure the paging
  was added to fix.
- **Confidence**: medium-high on the PostgREST/OFFSET semantics; high that the
  loops are unordered (code reading).
- **Fix direction**: add a deterministic sort before `.range()` —
  `.order("id")` (or `set_id,version` for badges) in both files; the same applies
  to the paged full-catalog read in `global.ts:76-86`.

---

## v12-04 — the IP-hash salt's fallback chain ends in a public constant, and the change re-keys every stored dedup row

- **Severity**: low (informational / hygiene)
- **Side**: server / gamification
- **File:line**: `src/lib/gamification/session.ts:44-54`
- **Evidence**: the salt is
  `IP_HASH_SALT ?? SUPABASE_SERVICE_ROLE_KEY ?? CRON_SECRET ?? "tbd"`. If none of
  the three is set the salt is the literal `"tbd"` — a public constant, i.e. the
  exact weakness srv-4 removed (the previous salt was
  `NEXT_PUBLIC_SUPABASE_URL`). In production the service-role key is present, so
  this is a configuration-dependent fallback rather than an active defect; but the
  new `IP_HASH_SALT` is not declared in `.env.example`, so nothing tells an
  operator to prefer it over the service-role key.
  Effect on stored rows: the hash input changes for every IP, so **every existing
  `ip_hash` in `profile_visits` and `blog_views`, and every existing
  `coin_rain_gate.giver_key`, becomes unmatched**. Concretely the 5-minute view
  dedup and the once-per-day coin-rain gate reset once at deploy (a visitor can
  be counted once more / rain once more the same day), and the old rows are
  permanent orphans: the dedup queries only ever read
  `created_at >= now() - 5 min`, and neither view table has a prune (only
  `pruneHeartbeats` and `prunedCoinRainGate` exist). The salt is also derived
  from a rotatable secret, so a future service-role-key rotation silently resets
  the same windows again.
- **Why it is a bug**: nothing is broken at runtime — the callers are all
  server-side (below) and the gate key stays a 40-char hash — but the fix ships an
  undocumented env var and a fallback that can silently degrade to a public salt,
  and its one-time effect on the stored dedup rows is not recorded anywhere.
- **Confidence**: high on the code and on the reset; medium on whether a
  deployment already sets `IP_HASH_SALT`.
- **Fix direction**: add `IP_HASH_SALT` to `.env.example` with a one-line note,
  and make the fallback fail loudly (or at least log) instead of falling through
  to `"tbd"`; document the one-time dedup reset in the changelog entry for this
  round.

---

## v12-05 — the badgebase guard cannot tell an incident from a legitimately empty `/active` listing

- **Severity**: low (rare state; trade-off of the srv-5 fix)
- **Side**: server / sync
- **File:line**: `src/lib/syncs/badgebase.ts:75-79`
- **Evidence**: `if (activeCards.length === 0) throw …`. The guard is correctly
  placed before every write in this function (the first mutation is the per-card
  `update` at `:187-194`; the guard precedes the `allBadges` read at `:91`), so it
  does block the destructive sweep. It is also correct for the incident case it
  targets. The gap is the opposite direction: if badgebase.de is genuinely
  serving an empty `/active` page (a window with no redeemable drop), the sync
  throws on every run and the demotion sweep (`:230-279`) never executes, leaving
  badges that should be `expired` marked `active` indefinitely — the run reports
  `status: error` for a real state of the world.
- **Why it is a bug**: it makes "refuse" the only response to a state that may be
  true, with no operator override and no upper bound. This is the same shape as
  v12-01: a volume/emptiness heuristic where a comparison against the previous
  run would separate "provider hiccup" from "the world changed".
- **Confidence**: medium (the state is rare — 22 active cards in the last
  recorded runs — so this is a robustness observation, not an observed failure).
- **Fix direction**: keep the refusal but allow it to be distinguished from a
  legitimate empty listing, e.g. refuse only when the previous run had cards
  (persist the count), or log a distinct `degraded` heartbeat with the counts so
  an empty-but-real listing can be confirmed rather than blocking the sweep.

---

## Areas checked and found clean

- **badgebase.ts guard placement** — `:75-79` precedes the first write
  (`:187-194`), the `:200-227` upsert, the `:230-279` sweep and the `:281` log.
  A fetch error already throws inside `fetchHtml` (`twitch/badgebase.ts:22-24`),
  so only a 200-with-unparseable-markup reaches the guard; the renamed changelog
  title (`:284`) is cosmetic. Note the file is **not** covered by a heartbeat of
  its own *inside* the global route — it runs under `withHeartbeat("sync/badgebase", …)`
  there, which is correct.
- **potat.ts `ownersOk`** (`:57`) — the fallback at `:143-145` substitutes the
  **stored** `badge.owner_count` for every distribution-matched badge, so
  `valuesChanged` is computed against the same value and the upsert at
  `:189-198` writes it back unchanged; `computeRarity` at `:149-165` is fed that
  same stored `totalOwners`, so rarity cannot be recomputed from a nulled count.
  An empty-but-resolved owners feed now reports `ownersFeedOk: false` and keeps
  every number.
- **queries.ts `getBadgeStatsHistory`** (`:274-288`) — descending +
  `.limit(limit)` + `.reverse()` yields the **newest** `limit` points in
  ascending order, which is what the only caller needs: the badge page
  (`[locale]/badges/[slug]/page.tsx:82-98`) maps the array straight into
  `chartData` and `OwnersChart` plots it in array order (left = oldest). No other
  caller exists (grep: one call site). `.reverse()` mutates only the fresh
  response array.
- **inventory.ts paged loop** (`:33-53`) — terminates on the first short page
  (`:52`), and a missing/`null` `data` yields `page=[]` so it breaks
  immediately; it cannot spin. The reward path (`:111-125`) receives the same id
  set as before and now additionally has real `slug`/`title` — the old
  `as unknown as Array<{slug,title}>` cast over a select that never fetched those
  columns was reading `undefined`, so this is a fix, not a regression. `catalog`
  is declared once and not shadowed.
- **sitemap.ts** (`:34-63`) — both loops terminate on a short page, both are
  inside the single `try`/`catch`, and `badges`/`posts` are `const` arrays pushed
  into. Live count unchanged at **5 808** (fetched).
- **session.ts callers** — all 12 files importing
  `@/lib/gamification/session` (7 API routes, 5 `[locale]` pages) are server
  components/routes; none carries `"use client"`, so the `node:crypto` import and
  the env read never enter a client bundle. The `ipHashFromRequest` path is the
  only source of an anonymous coin-rain key and it always yields 40 hex chars.
- **i18n parity** — the three keys added this round (`common.levelAria`,
  `common.streakDay`, `profile.shareTitle`) exist in all 11 locale files; a
  flat-key diff reports 675 keys × 11 identical and 0 missing / 0 extra. No
  `MISSING_MESSAGE` exposure.
- **stats page `uptimeSources` reshape** (`[locale]/stats/page.tsx:336-355`) —
  the raw `source` is stripped from the mapped objects; no consumer of
  `uptimeSources` reads `.source` (only `.key`/`.label`), and the one place that
  needs the raw id (`:506`) still uses `uptime.sources`. `LevelBadge`'s new
  `useTranslations` is safe: it has no `"use client"` and is only used from
  server pages.

## `apply_pair_deltas` runtime test (migration 0015) — **RAN, PASSED**

The outstanding test is no longer blocked. It ran over the transaction pooler
(port 6543) inside one transaction that was **rolled back**; the synthetic
`user_progress` rows were made insertable by dropping the profiles FK *inside the
same transaction* (DDL is transactional), and after the rollback the table is
back to its single row (`count=1`, `coins=1840`) with the FK
`user_progress_user_id_fkey` present. Results:

| check | input | result | expected |
|---|---|---|---|
| both rows updated, zero-sum | a=1000, b=500; `a_delta=-60`, `b_delta=+60` | `a_coins=940`, `b_coins=560`, sum **1500** | 1500 ✓ |
| clamp on A | `a_delta=-100000` | `a_coins=0`, `b_coins=560` | 0 ✓ |
| clamp on B | `b_delta=-100000` | `a_coins=5`, `b_coins=0` | 0 ✓ |
| missing row | `p_b` = unknown uuid, `a_delta=+7` | row still returned, `a_coins=12`, **`b_coins=null`** | one row, NULL for the absent side ✓ |
| return shape | `returns table(a_coins, b_coins)` | exactly 1 row | matches `Array.isArray(data) ? data[0] : data` and `.a_coins` ✓ |

The function definition read back from the database
(`pg_get_functiondef`) is byte-identical to the migration; both CTEs update their
row regardless of the other, `greatest(0, coins + delta)` clamping is preserved
and matches `add_coins` (`migration 0006:56-64`), and the whole transfer is one
statement. PostgREST path verified too: `anon` →
`401 / 42501 permission denied for function apply_pair_deltas`; `service_role`
with zero deltas on two non-existent uuids → `200 [{"a_coins":null,"b_coins":null}]`
(the parameter names `p_a/p_a_delta/p_b/p_b_delta` resolve exactly as `daily.ts`
calls them, and no row is touched).

**CHECK `coin_rain_gate_giver_key_len`** (migration 0015:46-48) — probed in
individually rolled-back transactions, owner = the real profile:

`len 0 → 23514`, `len 7 → 23514`, `len 8 → accepted`, `uuid(36) → accepted`,
`hash(40) → accepted`, `"anonymous"(9) → accepted`, `len 128 → accepted`,
`len 129 → 23514`. Every key the application can produce is ≥ 8 chars
(`giverId` is a uuid, `ipHashFromRequest` is 40 hex, else `"anonymous"`), so the
CHECK cannot reject a legitimate key; it closes v11-5 as intended and the table
still held 0 rows after the probes.

## Summary

2 medium-or-lower server findings that are genuinely new (v12-01 is the one that
can become an outage), 4 low/informational. The eight named areas otherwise
behave as the commits intend; the one previously-open item they touched —
`apply_pair_deltas`' runtime proof — is now done and passes.