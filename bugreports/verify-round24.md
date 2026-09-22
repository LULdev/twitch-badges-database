# Verification — Round 24

Scope: `df1222b` ("fix(db,profile): a recreated function had lost its
service-role-only grant") — migration `0019`, the three fp-3 profile fixes — and
`2f43059` ("fix(achievements): two specials now check what their descriptions
say") — `s_ghost_town`, `s_top_percent`, the new `topCoinsRes` query and
`accountAgeDays` / `isTopCoinHolder`.

Read-only with respect to project files: nothing was edited, created or deleted;
the only new file is this report. `git status --porcelain` is empty. Live DB work
was done through the session pooler (`5432`, no need for `6543`) in transactions
that were rolled back, plus read-only ACL/grant/catalog queries. The one live
`user_progress` row ends byte-identical to its pre-probe values
(`xp 3610 / coins 1840 / level 11 / game_xp_today 0 / game_xp_day null`); the
sanctioned `verify-atomic-economy.ts` run is the only production write and it
restored itself (`restore: EXACT`), with the single exception noted in
"Production-data note" below.

**Verdict up front:** the two commits under attack are correct where they claim
to be. `v23-01`'s ACL hole is closed and live-verified (all three economy RPCs
read `postgres + service_role` only, an anon call returns `42501`), migration
`0019` follows the `0011-0018` conventions and re-runs without a SQL error, and
the whole `public` function surface is accounted for — nothing anon-callable
writes anything. The three fp-3 fixes behave exactly as specified (owner bypass,
coins exactly once in every toggle combination, `bannerOverlay` defaults agree).
The new achievement signals are fail-safe. No **live** defect remains in scope
(item 6); the residual items below are latent (the single live profile has
`customization = {}` and the site has one member).

---

## Findings

### v24-01 — `v23-02` was only half-applied: the inventory *count* is still published as 0 to visitors of a hidden inventory — low

- **Severity:** low (false public statistic; latent — needs a member to hide the
  inventory, which no member has done)
- **Side:** UI (server component)
- **File:** `src/app/[locale]/profile/[username]/page.tsx:214` (the fixed
  `inventoryVisible`), but `:568-570` (section heading `{t("owned")}
  ({ownedBadges.length})`), `:399-412` (`owned` tile `:402`, `missing` tile
  `:406`, `completion` tile `:410`) and `:243` (`percent`) are all computed and
  rendered **outside** the `inventoryVisible` gate; only the grid at `:572` is
  gated (else `inventoryHidden`, `:582`).
- **Evidence (code):** for a non-owner when `inventoryVisible` is false,
  `getInventory` is skipped (`:217`) so `ownedBadges` stays `[]`; the heading
  then prints "Owned (0)", the stats section (default `showStats: true`) prints
  `owned 0`, `missing <totalCatalog>`, `completion 0%`. Round 23's own fix
  direction for `v23-02` named exactly this ("either suppress the stat tiles'
  owned/completion pair when the inventory is hidden or keep computing
  `ownedBadges` for the tiles while hiding only the grid"); the commit applied
  only the owner-bypass half. Reachability today is nil — the one live profile is
  `band1to` with `customization = {}` and `inventory_public` at its `true`
  default — so this is latent, not live.
- **Why it is a bug:** the profile page's stated contract for `showInventory` /
  `inventory_public` is "the member can hide their collection"; hiding the grid
  while printing `0 owned / N missing / 0%` does not hide the collection, it
  lies about it in the opposite direction. The residual is also *newly*
  reachable through `showInventory` (which did nothing before `710e139`), not
  only through the older `inventory_public` column.
- **Confidence:** high (code path read directly; the render sites are
  un-conditional on `inventoryVisible`); the live-state claim is confirmed
  (`customization = {}`, `profiles = 1`).
- **Fix direction:** gate the heading count and the three tiles on
  `inventoryVisible` (or keep computing `ownedBadges` for the tiles and hide only
  the grid), mirroring whatever `v23-02` chose for the owner.

### v24-02 — commit `2f43059` claims the atomicity script "exercises the full award path including the achievement evaluation"; it does not — the new signals have no checked-in coverage — info

- **Severity:** info (process / evidence trail; no behaviour change)
- **Side:** scripts / process
- **File:** `scripts/verify-atomic-economy.ts:58, :74, :80` (every `award()`
  passes `skipAchievements: true`), against the claim in `git show 2f43059`
  ("atomicity 16/16 (which exercises the full award path including the
  achievement evaluation)"). The skip short-circuits at
  `src/lib/gamification/xp.ts:333-334`.
- **Evidence:** the script's own header (`:8-11`) says it "Isolates the
  arithmetic with `skipAchievements` … which would mask the deltas". All three
  `award()` calls set the flag; the only achievement-related code is the cleanup
  at `:215-220`. The live run reports `achievementRowsRemoved=0` — i.e. the
  evaluation wrote no unlock row in 16 checks, confirming it never ran.
  `evaluateAchievements` is reached in production from `games.ts:198`,
  `daily.ts:243/:244/:348` and `xp.ts:334`, but by no `npm run`-able script.
- **Why it is a bug:** the tamper-evident trail is the project's stated evidence
  rule. The two new condition branches (`s_ghost_town`'s `accountAgeDays`,
  `s_top_percent`'s `isTopCoinHolder`) and the new `topCoinsRes` query are
  therefore unexercised by the ritual; a mistake in them (or in the
  `Promise.all` position of `topCoinsRes`) would not be caught by any gate.
- **Confidence:** high (deterministic read of the script + the live
  `achievementRowsRemoved=0`).
- **Fix direction:** correct the commit narrative, and either drop
  `skipAchievements` on one dedicated check (asserting an unlock row appears) or
  add a small scripted call to `evaluateAchievements` against a rolled-back
  fixture. (Note `v23-05` already tracks the sibling issue that the same script
  still calls `consume_game_xp`.)

### v24-03 — `s_top_percent`'s new ranking has no tie-break and no coin floor, so "The 1%" can unlock with 0 coins once the site passes 20 members — low

- **Severity:** low (latent: needs `userCount >= 20`; the site has 1 member)
- **Side:** logic (`src/lib/gamification/achievements.ts`)
- **File:** `:216` (`(s) => s.userCount >= 20 && s.isTopCoinHolder`) and the
  query at `:452-458` (`.select("user_id").order("coins", { ascending: false })
  .limit(3)`).
- **Evidence (live):** `profiles = 1`, `user_progress = 1`,
  `userCount = 1 < 20` → the achievement is locked today. The plan for the query
  is `Limit → Sort (Sort Key: coins DESC) → Seq Scan on user_progress` — there is
  no secondary sort key.
- **Why it is a bug:** two distinct statements resolve arbitrarily. (a) Ties:
  with 4+ members on equal `coins` at the third rank, Postgres returns an
  arbitrary 3 of them, so two identically rich members are treated differently —
  the very thing a "ranking" is supposed to decide deterministically. (b) Floor:
  the condition has no lower bound, so on a 20-member site where fewer than three
  members hold any coins, the sort selects 0-coin rows and a brand-new player
  unlocks "The 1%" holding nothing — a *weaker* gate than the 50,000-coin
  threshold it replaced. The 20-user minimum was kept deliberately, but it does
  not make the ranking meaningful when the coin distribution is mostly zero.
- **Confidence:** high for the code/plan; the exploit row is latent by
  construction (`userCount >= 20` is not satisfiable today).
- **Fix direction:** add a deterministic tie-break (`order("coins").order("user_id")`)
  and either a minimum (`isTopCoinHolder && s.progress.coins > 0`, or reuse a
  modest threshold) or a rank-with-dense-tie count (`order by coins desc` plus
  `count(*) … = 3` semantics) so equal holders all qualify.

### v24-04 — the `topCoinsRes` query is an unindexed sequential scan repeated on every achievement evaluation — info

- **Severity:** info (no defect at current scale)
- **Side:** DB / performance
- **File:** `src/lib/gamification/achievements.ts:452-458`
- **Evidence:** `pg_indexes` on `user_progress` lists only
  `user_progress_pkey (user_id)`; the plan for the query is a `Seq Scan` + `Sort`
  over the whole table, executed inside `buildStats`, i.e. once per
  `evaluateAchievements` call (which fires from every game round, daily claim and
  award). `LIMIT 3` bounds the heap, so the cost is O(rows), not O(rows log
  rows).
- **Why it is worth recording:** at 1 row it is free; at a few hundred thousand
  members it is a full scan on the hottest write table, run per round. Not a
  correctness issue and not a live defect.
- **Confidence:** high (live `pg_indexes` + `EXPLAIN`).
- **Fix direction:** if it ever matters, add `create index on
  public.user_progress (coins desc)` or maintain a materialised leaderboard.

### v24-05 — the DB's default ACL grants `EXECUTE` to `anon`/`authenticated` on every newly created function; two orphan read-RPCs and four trigger functions still carry it — info

- **Severity:** info (grant hygiene; none of these is exploitable)
- **Side:** DB
- **File:** root cause is Supabase's `alter default privileges in schema public`
  (visible only as behaviour); the live `public` grants are the evidence.
- **Evidence (live `pg_proc.proacl`):** `handle_new_user()`,
  `protect_profile_columns()`, `touch_updated_at()` and
  `touch_badges_updated_at()` all carry the leading `=X/postgres` PUBLIC entry
  (plus, for the `0006`/`0001` ones, explicit `anon`/`authenticated`), as does
  `latest_badge_stats(int)` (anon + authenticated, intentional) and
  `get_own_profile_email()` (authenticated only, intentional). Running
  `set local role anon; select public.touch_updated_at();` returns
  **`0A000 trigger functions can only be called as triggers`** — Postgres refuses
  direct invocation regardless of EXECUTE, so no anonymous caller can reach them.
  `latest_badge_stats` is a read-only public view of `badge_stats`
  (`security invoker`), and `get_own_profile_email` is
  `security definer`, `set search_path = ''`, and reads
  `email from public.profiles where id = (select auth.uid())` — self only. Both
  are deliberate public API; neither is an economy RPC.
- **Why it is worth recording:** this default is exactly what turned `0018`'s
  drop-and-recreate into a live exposure (and what `0019` re-closed). Any future
  `create function` / `create or replace` in `public` re-acquires the anon grant
  silently, so the per-migration `revoke … from public; revoke … from anon,
  authenticated` tail is load-bearing and should stay part of the shared pattern
  (the `v23-01` fix direction suggested a shared tail; `0019` implements it
  inline).
- **Confidence:** high (live ACL read + a live, rolled-back anon call).
- **Fix direction:** keep the revoke/grant tail in every migration that creates
  or replaces a function; optionally add a one-shot `alter default privileges in
  schema public revoke execute on functions from anon, authenticated` so a
  forgotten tail fails safe.

---

## Areas found clean

### 1. Migration `0019` and the live ACLs (item 1) — clean

The three reviewed functions are **identical** and **service-role only**:

| function | live `proacl` | anon | authenticated | PUBLIC |
|---|---|---|---|---|
| `consume_and_apply_game_xp(uuid, date, int, bigint)` | `postgres=X/postgres \| service_role=X/postgres` | no | no | no |
| `consume_game_xp(uuid, date, int)` | `postgres=X/postgres \| service_role=X/postgres` | no | no | no |
| `apply_xp_coins(uuid, bigint, bigint)` | `postgres=X/postgres \| service_role=X/postgres` | no | no | no |

No `PUBLIC` (`=X/postgres`) entry survives on any of the three, and
`has_function_privilege('anon'|'authenticated', …, 'EXECUTE')` is **false** for
all three (checked live). A real anon call, inside a rolled-back transaction:

```
set local role anon;
select public.consume_and_apply_game_xp('0000…'::uuid, current_date, 1, 0);
-- ERROR 42501 permission denied for function consume_and_apply_game_xp
```

`consume_game_xp` and `apply_xp_coins` likewise return `42501`. The ledger shows
`0019_restore_game_xp_grants.sql` applied once (`2026-09-22T17:58:28.114Z`) and
exactly one changelog row (`id 311`, "Economy RPC: the recreated function had
lost its service-role-only grant").

### 2. Migration `0019` hygiene (item 2) — clean

- **Conventions:** it matches `0011-0018` — a changelog `insert … (kind, title,
  body, payload)` (so the `/changelog` page and RSS are automatic) and
  `notify pgrst, 'reload schema'`. It carries the same leading `-- v23-01:`
  narrative comment style as its siblings, and like **every** migration in the
  directory it ends on `;` with no trailing newline (verified byte-wise for
  `0011-0019`) — no drift.
- **Re-run safety:** running the whole file inside a rolled-back transaction
  completes with no SQL error, and the ACL is unchanged afterwards. The three
  ACL statements are idempotent; the only non-idempotent statement is the
  changelog `insert` (a manual re-run would add a duplicate row), which is true
  of `0011-0018` as well. `scripts/db-apply.ts` applies each file once inside a
  single transaction and records it in `supabase_migrations`, so a normal
  `npm run db:apply` cannot replay it, and a mid-migration crash rolls the whole
  file back.
- **Scope discipline:** the file touches only `consume_and_apply_game_xp` — no
  other function, no table, no policy — so it cannot have regressed a sibling
  grant. The sibling grants were re-read after it and are unchanged.

### 3. The whole `public` function surface (item 1) — clean; nothing anon-callable writes

All 16 functions in `public`, with what the live ACL actually permits. No
function lost a grant to a later migration: every economy helper that `0008`
hardened still reads `postgres + service_role` only, and `0015`'s
`apply_pair_deltas` is restricted as written in its own migration.

| # | function | live ACL | callable by anon/authenticated? | verdict |
|---|---|---|---|---|
| 1 | `add_coins(uuid, bigint)` | postgres, service_role | no | economy, restricted |
| 2 | `apply_pair_deltas(uuid, bigint, uuid, bigint)` | postgres, service_role | no | economy, restricted |
| 3 | `apply_xp_coins(uuid, bigint, bigint)` | postgres, service_role | no | economy, restricted |
| 4 | `bump_counters(uuid, jsonb)` | postgres, service_role | no | economy, restricted |
| 5 | `bump_view_count(uuid)` | postgres, service_role | no | economy, restricted |
| 6 | `claim_daily_gate(uuid, date)` | postgres, service_role | no | economy, restricted |
| 7 | `claim_wheel_gate(uuid, date)` | postgres, service_role | no | economy, restricted |
| 8 | `consume_and_apply_game_xp(uuid, date, int, bigint)` | postgres, service_role | no | **0019 target — fixed** |
| 9 | `consume_game_xp(uuid, date, int)` | postgres, service_role | no | economy, restricted |
| 10 | `rls_auto_enable()` | postgres, service_role | no | event trigger; restricted |
| 11 | `get_own_profile_email()` | postgres, authenticated, service_role | authenticated only | intentional self-read, `security definer`, `auth.uid()` scoped |
| 12 | `latest_badge_stats(int)` | postgres, anon, authenticated, service_role | anon + authenticated | intentional public read of `badge_stats` |
| 13 | `handle_new_user()` | PUBLIC + postgres, anon, authenticated, service_role | PUBLIC execute, **but** returns `trigger` | `0A000` on direct call — not reachable |
| 14 | `protect_profile_columns()` | PUBLIC + postgres, service_role | PUBLIC execute, **but** returns `trigger` | `0A000` — not reachable |
| 15 | `touch_updated_at()` | PUBLIC + postgres, anon, authenticated, service_role | PUBLIC execute, **but** returns `trigger` | `0A000` — not reachable |
| 16 | `touch_badges_updated_at()` | PUBLIC + postgres, anon, authenticated, service_role | PUBLIC execute, **but** returns `trigger` | `0A000` — not reachable |

(Also checked: `graphql_public.graphql` is anon-callable — Supabase's stock
GraphQL endpoint, not an economy function; `auth.*` functions are
`supabase_auth_admin`-owned; no `security definer` writer exists in `public`
outside the list above.)

Two of the sixteen (`latest_badge_stats`, `get_own_profile_email`) are live but
defined by no migration file — schema drift worth recording, not a defect: both
are intentional reads and neither is referenced from `src/` (see `v24-05`).

### 4. The three fp-3 fixes (item 3) — the required properties all hold

- **Owner always sees their inventory, toggle or not.** `:214`
  `inventoryVisible = isOwn || (profile.inventory_public && showInventory)`; the
  `isOwn` disjunct (`:80`, `viewer.id === profile.id`) is evaluated first, so
  `showInventory: false` and `inventory_public: false` both leave the owner's
  grid rendered. The owner's stat tiles are also correct again, because
  `getInventory` is no longer skipped for them (`:217`).
- **A visitor with `inventory_public: false` sees the hidden card, not the
  grid.** `inventoryVisible` false → `:217` skips the fetch → `:572` takes the
  `inventoryHidden` branch. (The heading/stat-tile residue is `v24-01`.)
- **Coins appear exactly once in every toggle combination.** Two render sites
  only: `:337` (inside `{level && showLevel && …}`) and `:348` (guarded by
  `progress && showCoins && !showLevel`). They are mutually exclusive, so
  `showLevel: true, showCoins: true` → 1, `true/false` → 0, `false/true` → 1,
  `false/false` → 0. `grep` confirms no third `progress.coins` site.
- **Coins still appear with only `showCoins` on.** `:348` needs no `level`, only
  `progress`, so a member with `levelFromXp(0)` and `showLevel: false` still gets
  the balance line.
- **Every shared key's default agrees.** Keys both the customizer's `DEFAULTS`
  and the page read are exactly seven; all seven match:
  `showStats true/true`, `showInventory true/true`, `showLevel true/true`,
  `showCoins true/true`, `showVisitors true/true`, `nameGradient ""/""`,
  `bannerOverlay 0/0` (`ProfileCustomizer.tsx:60-62` vs `page.tsx:191-204`).
  `bannerOverlay`'s range input stores a `Number` (`ProfileCustomizer.tsx:236`),
  which the page's `number()` accepts, so type semantics agree too.
- **No regression for a member with no settings:** `bannerOverlay = 0` renders
  no overlay child (`:289-295`), matching the pre-commit markup.

### 5. The two new achievement signals (item 4) — fail-safe; evaluation runs in production

- **`accountAgeDays` is `Infinity` when `created_at` is unavailable** (`:599-604`):
  missing row → `profileRes.data` null → `Number.POSITIVE_INFINITY`, and a
  present-but-unparseable value also yields `Infinity`. `Infinity <= 7` is
  `false`, so `s_ghost_town` stays **locked**, not unlocked-for-everyone. The
  column is `not null default now()` (`0001_init.sql:151`), so the branch is
  reachable only when the profile row is missing.
- **`isTopCoinHolder` is fail-safe:** the query result is read as
  `(topCoinsRes.data ?? [])` and never has `.error` checked, so a query failure
  becomes an empty set → `false` → locked rather than an exception. `buildStats`
  has no unguarded `throw`.
- **The query works against the live DB:** running the exact PostgREST call
  (`.from("user_progress").select("user_id").order("coins", {ascending:false})
  .limit(3)`) as the service client returns `error: null`, 1 row; the profile
  select including `created_at` also returns `error: null` with a real timestamp.
- **`Promise.all` positions are consistent:** the array has 15 entries and the
  destructuring at `:407-408` lists 15 names in the same order, with
  `topCoinsRes` at index 12 in both; `topCoinsRes` is not accidentally bound to
  another query's result.
- **The full evaluation does run in production** — `evaluateAchievements` is
  invoked from `games.ts:198`, `daily.ts:243/:244/:348` and `xp.ts:334`, and both
  specials are members of `ACTIVE_ACHIEVEMENTS` (neither is in
  `RETIRED_ACHIEVEMENT_IDS`). Only the *checked-in coverage* claim is wrong
  (`v24-02`). The ranking semantics are `v24-03`/`v24-04`.

---

## Item 5 — both economy scripts, exact numbers

**`npx tsx scripts/verify-atomic-economy.ts`** → **16/16 PASSED**,
`ALL CHECKS PASSED`,
`restore: EXACT (xp 3610/3610, coins 1840/1840, level 11/11)
feedRowsRemoved=0 achievementRowsRemoved=0`:

```
PASS single award xp: got 3, expected 3
PASS single award coins: got 2, expected 2
PASS concurrent xp survives (3+11+13): got 27, expected 27
PASS concurrent coins survive (2+5+7): got 14, expected 14
PASS bumpCoins +7: got 7, expected 7
PASS bumpCoins round-trip returns to start: got 1854, expected 1854
PASS negative guard: got 0, expected 0
PASS 5 concurrent games_played bumps: got 5, expected 5
PASS 5 concurrent times_robbed bumps: got 5, expected 5
PASS daily gate: exactly one winner: got 1, expected 1   (gate results: -1 / 1)
PASS daily gate: winner got streak 1: got 1, expected 1
PASS daily gate: last_login_date stamped: got 1, expected 1
PASS daily gate: nobody wins twice: got 0, expected 0
PASS wheel gate: exactly one winner: got 1, expected 1
PASS game XP budget capped at 100: got 100, expected 100  (granted: 20 + 80)
```

**`npx tsx scripts/verify-game-economy.ts`** → **13/13 below the stake**, worst
game **hilo 0.9851** (the commit reported 0.9844/0.9850 — simulation variance):

| game | rounds | avg payout/bet | win rate |
|---|---|---|---|
| rps | 200 000 | 0.9677 | 33.3% |
| slots | 40 000 | 0.1319 | 3.5% |
| shoot | 200 000 | 0.8985 | 44.9% |
| memory | 200 000 | 0.8863 | 44.3% |
| quiz | 200 000 | 0.8019 | 40.1% |
| coinflip | 200 000 | 0.9678 | 49.9% |
| hilo | 200 000 | **0.9851** | 49.9% |
| roulette | 200 000 | 0.3828 | 2.7% |
| blackjack | 200 000 | 0.5840 | 26.9% |
| vault | 200 000 | 0.9008 | 45.0% |
| scratch | 200 000 | 0.9803 | 24.5% |
| tower | 200 000 | 0.9041 | 74.1% |
| catcher | 200 000 | 0.8598 | 43.0% |

**Production-data note.** `verify-atomic-economy.ts` is the one sanctioned
writer. Its own restore restores every column of the single `user_progress` row
from a snapshot, then re-stamps `updated_at = now()` (`:207`), so the row's
`updated_at` now reads `2026-09-22T18:11:28.982Z`; `xp`, `coins`, `level`,
`login_streak`, `last_login_date` and the game-XP columns are byte-identical to
before (`3610 / 1840 / 11 / 1 / 2026-09-22 / null, 0`). `activity_events` stayed
at 20 rows and `user_achievements` at 13 — no test rows were left behind
(`verify leftovers: 0`). All other probes ran in transactions that were rolled
back (`proacl`, changelog count and the function ACLs were re-read afterwards and
are unchanged).

---

## Item 6 — does any **live** defect remain in these commits' scope?

**No.** Every defect these two commits set out to fix is fixed and, for the one
that was live, verified fixed against the live database:

- `v23-01` (the orphaned ACL) was the only **live** state deviation in scope
  (`verify-round23` §Item 5 said so). Migration `0019` is applied, all three
  economy RPCs now read `postgres + service_role` only, no `PUBLIC`/`anon`/
  `authenticated` grant remains on any of them, and a real anon call returns
  `42501`. That is a live state, live-checked, not a code claim.
- `v23-02`/`v23-03`/`v23-04` were latent and stay latent: the single live profile
  (`band1to`) has `customization = {}`, `inventory_public` at its `true` default
  and `userCount = 1`, so no rendered page changes and no member-facing value is
  wrong today. The residual `v24-01` is part of that same latent set.
- The two achievement fixes cannot misfire live: `accountAgeDays` is `Infinity`
  → locked whenever `created_at` is unavailable, the query is fail-safe on error,
  and the ranking branch is gated behind `userCount >= 20` (live count 1). The
  one data artifact — the lone profile already holds the `Ghost Town` unlock that
  the old condition fired on (`activity_events` id 19, "unlocked: Ghost Town")
  — is a consequence of the pre-fix bug, not a defect in these commits, and
  revoking an achievement retroactively would be worse than leaving it.
- The only imperfections left are process/coverage (`v24-02`), latency-bound
  semantics (`v24-03`, `v24-04`) and the systemic default-ACL note (`v24-05`);
  none of them is a live defect.

---

## Method / reproduction notes

- Live reads: session pooler (`.env.local` `SUPABASE_DB_URL`), `postgres` package;
  no secret printed. Port `5432` via the pooler worked, so `6543` was not needed.
- ACL evidence: `pg_proc.proacl` + `has_function_privilege(role, 'public.fn(sig)',
  'EXECUTE')`; reachability: `set local role anon` inside `sql.begin` + forced
  rollback.
- Migration re-run: the full `0019` text executed in a transaction that was
  rolled back; `proacl` and the changelog count re-read afterwards.
- Progress row: snapshot compared before/after the sanctioned script only.