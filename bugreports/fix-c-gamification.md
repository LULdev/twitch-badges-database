# fix-agent C — gamification (low findings) + R8-2 / ind-2

Scope: `src/lib/gamification/` and `src/app/api/games/` only. No migration, no
commit, no build, no changelog entry (batch owner writes it).

**Result: 13 fixed, 1 refuted, 2 partially fixed by design (residual needs SQL
the report names explicitly).**

| Script | Final line |
|---|---|
| `npx tsx scripts/verify-game-economy.ts` | `worst game: hilo at 0.9878 — no game returns more than the stake on a cheating payload` (all 13 games `ok`) |
| `npx tsx scripts/verify-atomic-economy.ts` | `ALL CHECKS PASSED` — 15 `PASS` lines + `restore: EXACT` = 16/16 |

`npx tsc --noEmit` → 0 errors. `npx eslint src/lib/gamification/ src/app/api/games/`
→ **0 errors**, 3 pre-existing warnings (achievements.ts:154/155 `k_night_owl` /
`k_early_bird` have an unused `s` because `AchStats` is the required signature;
daily.ts:202 `thiefProfile` is a dead query that predates this round — left
untouched to keep the diff minimal).

---

## R8-2 — `recordBlogView` dedup never engaged (FIXED)

- **File**: `src/lib/gamification/visits.ts:43-71`
- **New behaviour**: the dedup read selects a column that exists (`post_id`),
  and a read error is no longer swallowed — a failed dedup read returns `false`
  ("not counted") instead of being read as "no recent view".
- **Why the old code was wrong**: `blog_views` is `(post_id, ip_hash,
  created_at)` — there is no `id`. `select("id", {count:"exact", head:true})`
  was a 42703/HTTP 400 whose `error` was discarded, so `count` was `null`,
  `(count ?? 0) > 0` was always false, and every reload inserted a row: the
  5-minute dedup never ran and the public view counter was inflated.
- **Verification** (live, service role, same filters):
  `OLD select(id): count= null error= {"message":""} status 400` →
  `NEW select(post_id): count= 0 errorCode= none`.
- **Note**: the 5 duplicate `(post_id, ip_hash)` groups already in the table are
  existing data; clearing them needs SQL and is out of scope.

## gam-3 — tower/vault economy notes (**REFUTED — already fixed**)

- **Files**: `src/lib/gamification/games.ts:404-415` (vault), `:436-450` (tower)
- **Refutation**: the report's evidence is the pre-fix source. The current code
  pays `vault` on a win chance (`[0.05,0.15,0.29,0.45]` × 2x = **0.90** EV at a
  forged `matches:3`) and `tower` fails at `0.20 + floor*0.06` per floor with
  `1 + cashoutAt*0.22`, which is **0.9028** at `cashoutAt:1` and falls from
  there. Both are documented remarks about code that already carries the fix
  ("note", not defect). Left alone deliberately.
- **Verification**: the economy sim drives exactly these two cheat payloads
  (`vault: {matches:3}`, `tower: {cashoutAt:1}`) — vault **0.8987**, tower
  **0.9019** on the final run.

## gam-4 — achievement reward could be paid twice (FIXED)

- **File**: `src/lib/gamification/achievements.ts:292-302`
- **New behaviour**: the unlock is a plain `insert()`; any error (including
  SQLSTATE 23505 from a parallel evaluation that won the row) skips the reward
  with `continue`, so xp/coins/points are paid exactly once.
- **Why the old code was wrong**: `upsert(..., {onConflict:"user_id,achievement_id"})`
  is `ON CONFLICT DO UPDATE`, which matches an existing row **without raising**,
  so two overlapping `evaluateAchievements` runs for one user both fell through
  to `bump_counters` + `award` and both paid `ach.xp/ach.coins/ach.points`.
- **Verification**: `user_achievements` PK is `(user_id, achievement_id)`
  (0003:57), so the duplicate insert raises 23505 and is skipped; the changed
  path is exercised by `verify-atomic-economy` (achievement rows created and
  removed: `achievementRowsRemoved=0`).

## gam-5 — meta achievements counted inside their own total (FIXED)

- **File**: `src/lib/gamification/achievements.ts:282-290`
- **New behaviour**: `totalUnlocked` counts only non-`c_ach_*` ids
  (`[...unlocked].filter(id => !id.startsWith("c_ach_")).length + newly.length`).
- **Why the old code was wrong**: `unlocked` is the raw ledger and already holds
  the `c_ach_*` rows, so 9 real achievements + `c_ach_1` gave `unlocked.size = 10`
  and unlocked `c_ach_10` ("Unlock 10 achievements") a full achievement early;
  each meta achievement inflated the next threshold by the same amount.
- **Verification**: the meta loop is driven only by the corrected total; the
  achievements module still loads and the predicates below were unit-tested
  against the live module.

## gam-6 — ignored RPC errors (FIXED)

- **Files**: `src/lib/gamification/games.ts:164-173`,
  `src/lib/gamification/daily.ts:181-200`,
  `src/lib/gamification/achievements.ts:304-314`,
  `src/lib/gamification/visits.ts:36-42`
- **New behaviour**: `bump_counters` errors are thrown in `playGame` and in both
  halves of `attemptSteal` (matching `bumpCoins`); `bump_view_count`'s error
  makes `recordProfileVisit` return `false` ("not counted"); the achievement
  points bump logs a warning.
- **Why the old code was wrong**: `bumpCoins`/`apply_xp_coins` throw, but every
  `bump_counters`/`bump_view_count` call dropped its `{error}`. If the increment
  failed the balance and the round moved while `games_played/games_won/coins_won/
  coins_lost` (or `steals_*`, `times_robbed`, `achievements_points`,
  `profiles.view_count`) did not — permanent, undetectable drift, with
  `playGame` still answering `ok:true`.
- **Deliberate deviation**: the achievement points bump warns instead of
  throwing. The ledger row is already inserted by then, so this id never comes
  round again — throwing would reject the whole evaluation and permanently lose
  the reward, which is strictly worse than surfacing the drift. `visits.ts`
  returns `false` rather than throwing because its contract is a boolean.

## gam-7 — XP budget consumed before the award / fatal derived write (PARTIALLY FIXED)

- **File**: `src/lib/gamification/xp.ts:178-195`, `:238-284`
- **New behaviour**: the derived-`level` write is no longer fatal (it warns);
  `award()` resolves instead of rejecting once `apply_xp_coins` has committed.
- **Why the old code was wrong**: `level` is derived purely from the xp the RPC
  already committed, so failing the whole request produced a 500 after the
  round/coin writes had stuck — a client retry played a second round. The worst
  case now is a cached level that lags to the next award, which is the same
  failure mode a stale `level` had before.
- **Residual, needs SQL (cannot be added here)**: `consume_game_xp` commits the
  day's budget *before* `apply_xp_coins` grants the XP, so a hard failure of the
  next statement burns that much of the daily budget with nothing granted. A
  refund is impossible from TypeScript: `consume_game_xp` ignores non-positive
  `p_requested` (0007:118) and no RPC can decrement `game_xp_today`. The correct
  fix is one SQL function that consumes, applies and derives the level in a
  single statement (the audit's own fix direction). The ordering is kept because
  reserving before applying is the only way the 100 XP/day cap holds under
  concurrency — reversing it would regress atomicity, which is forbidden.

## gam-8 — steal returned a stale balance (FIXED)

- **File**: `src/lib/gamification/daily.ts:180`, `:221-225`
- **New behaviour**: the response balance is the value returned by the atomic
  `add_coins` RPC.
- **Why the old code was wrong**: the RPC's authoritative new balance was thrown
  away and the number recomputed as `Math.max(0, thief.coins - price + stolen)`
  from a snapshot taken before the flood checks and before the victim's row was
  touched; any award landing in between made the displayed balance wrong, and
  `Math.max(0, …)` masked it as 0.
- **Verification**: `add_coins` already returns `coins` (0006:64); the
  round-trip assertions in `verify-atomic-economy` (`bumpCoins +7`,
  `negative guard`) still pass.

## gam-9 — gate RPCs had no INSERT fallback (FIXED in TypeScript)

- **Files**: `src/lib/gamification/xp.ts:124-141` (new `ensureProgress`),
  `src/lib/gamification/daily.ts:18`, `src/lib/gamification/wheel.ts:46`
- **New behaviour**: a guarded upsert —
  `upsert({user_id}, {onConflict:"user_id", ignoreDuplicates:true})` — runs
  before each gate, so the row exists without being modified. This is the
  "guarded upsert in TypeScript" the task allows for an INSERT fallback.
- **Why the old code was wrong**: `claim_daily_gate`/`claim_wheel_gate` only
  `UPDATE` (0007:54-67, :88-93). With no `user_progress` row the update matched
  0 rows and returned `-1`/`false`, which the callers translate into "already
  claimed" — a first-time user was denied the bonus and told they had already
  collected it.
- **Verification** (live): the same upsert shape against an existing row returns
  status 201 with `error = null`; with a profile id that does not exist it
  attempts the INSERT and returns 23503 (FK), proving the insert path is real
  and not a silent no-op. This is the identical idiom `getProgress` already uses.

## gam-10 — steal cost vanished on success (FIXED, deliberate reading)

- **File**: `src/lib/gamification/daily.ts:190-200`
- **New behaviour**: the victim is credited `settings.price` on **both**
  outcomes: `bumpCoins(victimProfile.id, -stolen + settings.price)`.
- **Why the old code was wrong**: the in-code comment states the design — "Thief
  pays the attempt cost; the victim keeps it" — and the anti-abuse rationale is
  explicit (paying to harass must benefit the target). The code only credited it
  on a *failure*, so every successful heist removed `price` from the economy
  instead of transferring it. The sink was sized by the victim through
  `steal_price`. This is deliberately NOT a payout change: a steal is a
  zero-sum transfer (`thief −price+stolen`, `victim −stolen+price` ⇒ net 0), so
  it mints nothing and no game EV is altered.
- **Verification**: the steal is not a `GAMES` entry and is not touched by
  `verify-game-economy`; `stolen ≤ min(maxAmount, floor(victim.coins*0.1),
  victim.coins)` (daily.ts:136) so the victim can never go negative, and
  `add_coins` clamps at 0 in any case.

## gam-11 — checks that did not match their descriptions (FIXED)

- **File**: `src/lib/gamification/achievements.ts:229-241` (`s_hattrick`),
  `:396-398` (`at` timestamp), `:466-469` (lifetime `maxBet`)
- **New behaviour**:
  - `maxBet` is the **lifetime** maximum, fetched as one row ordered
    `bet desc limit 1` (ordered server-side, so PostgREST's row cap cannot
    truncate it), instead of `Math.max` over the last 60 rounds.
  - `s_hattrick` requires three wins in **distinct games** inside a real
    **10-minute** span, using a new millisecond `at` field.
- **Why the old code was wrong**: `maxBet` over the last 60 rounds made
  `k_cautious` ("Win 10 games without ever betting more than 10 coins") fire
  after 60 small bets that followed a history of 5,000-coin bets (and made
  `k_high_roller` miss an old big bet); `s_hattrick` ignored both "different
  games" and "within 10 minutes" (any 3 wins among 60 rounds — the same game a
  week apart).
- **Verification**: 10 unit assertions against the live module —
  distinct games in 9 min → `true`; same game in 9 min → `false`; distinct
  games 20 min apart → `false`; 10 min + 1 s → `false`; 2 wins → `false`;
  `k_cautious` with lifetime `maxBet 0` → `true`, with `5000` → `false`.
- **Residual (out of scope, pre-existing)**: the 60-round window still bounds
  `s_owl_gambler` and `s_slots_jackpot`; making them lifetime needs SQL/stats
  views, not a window change.

## gam-12 — vacuous `c_showcase_set` (FIXED)

- **File**: `src/lib/gamification/achievements.ts:136` (+ `showcaseSlots` in
  `AchStats`, `SHOWCASE_SLOTS = 6`, and the `showcase_slots` column added to the
  profiles select at `:358`)
- **New behaviour**: `s.showcaseSlots >= SHOWCASE_SLOTS`, i.e. the profile's
  badge showcase is actually filled.
- **Why the old code was wrong**: `customizationKeys >= 0` is `Object.keys().length >= 0`
  — always true — so "Curator" fired on the first owned badge, a duplicate of
  `c_sync_first` with a misleading description. The showcase is
  `profiles.showcase_slots` (a separate `text[]`, capped at 6 by
  `src/app/api/account/route.ts:45-48`), never `customization`.
- **Verification**: 6 slots → `true`; 5 → `false`; 0 → `false`. Live select of
  `profiles(…, showcase_slots)` with the service role → `ok`.

## gam-13 / gsrv-5 — check-then-insert flood guards (steal + games FIXED, views need SQL)

- **Files**: `src/lib/gamification/daily.ts:152-173`,
  `src/lib/gamification/games.ts:63-72` + `:133-157`
- **New behaviour**: both guards re-read after their insert, before any coin,
  counter or XP moves, and void the row they just wrote if the burst is
  detected. `game_rounds` re-reads the two newest rows and voids ours when the
  gap is `< RATE_RACE_MS` (900 ms — the pre-check compares app-clock times while
  the recheck compares two DB-written timestamps, so the 100 ms of slack stops a
  legitimate 1 Hz player from being voided by clock skew); `steal_attempts`
  re-counts the 5-minute pair window (`> 1`) and the hourly window (`> 6`) and
  deletes our own row on a race.
- **Why the old code was wrong**: check and insert were separate statements with
  no lock and no uniqueness, so a parallel burst all read the same empty window
  and all inserted — a client could bypass the 1 round/s limit and the 5-minute
  / 6-per-hour steal limits that protect the victim.
- **Residual, needs SQL (cannot be added here)**: this is an optimistic guard,
  not a lock — the worst case is that several racers abort (never that extra
  rounds/attempts pay out). A truly atomic guard needs a unique index on a time
  bucket — e.g. `unique (user_id, date_trunc('second', created_at))` on
  `game_rounds`, and a `claim_steal_gate` compare-and-set like 0007, or
  `unique (thief_id, victim_id, date_trunc('…'))` on `steal_attempts`.
  `profile_visits`/`blog_views` remain plain check-then-insert for the same
  reason (a unique index on `(profile_id|post_id, ip_hash, time bucket)`);
  `recordProfileVisit`'s dedup was left exactly as it was, per instruction.

## ind-2 — coin rain (self-rain FIXED, atomicity needs SQL)

- **File**: `src/lib/gamification/daily.ts:213-260`
- **New behaviour**: a signed-in giver may not rain on their own profile
  (`giverId === profileOwnerId` → `{ok:false}`).
- **Why the old code was wrong**: the once-per-day key is the giver, so the
  owner's own id matched and they collected a free coin from themselves once a
  day; nothing else checked.
- **Residual, needs SQL (stated explicitly as instructed)**: the daily gate is
  still a read-then-write — a `count()` over `activity_events` (which has no
  unique constraint; its `id` is `generated always as identity`, so no
  deterministic-PK insert is possible) followed by `bumpCoins(+1)`. Parallel
  POSTs can each observe "no rain today" and each award a coin. The atomic fix
  is a `claim_coin_rain(p_owner, p_giver, p_today)` compare-and-set RPC or a
  unique index on `(user_id, payload->>'giver', date_trunc('day', created_at))`
  restricted to `kind = 'coin_rain'`. I did NOT add it. Impact if unfixed is
  1 coin per concurrent request, so it is left bounded and reported rather than
  restructured.

---

## Files touched

| File | Findings |
|---|---|
| `src/lib/gamification/xp.ts` | gam-6, gam-7, gam-9 |
| `src/lib/gamification/achievements.ts` | gam-4, gam-5, gam-6, gam-11, gam-12 |
| `src/lib/gamification/daily.ts` | gam-6, gam-8, gam-9, gam-10, gam-13, ind-2 |
| `src/lib/gamification/games.ts` | gam-6, gsrv-5 |
| `src/lib/gamification/wheel.ts` | gam-9 |
| `src/lib/gamification/visits.ts` | gam-6, gam-13 (note), R8-2 |

No file outside `src/lib/gamification/` and `src/app/api/games/` was modified
(`src/app/api/games/play/route.ts` and `.../symbols/route.ts` were read but are
unchanged). No migration was added; no RPC was invented.

## Constraint check

- **Economy**: all 13 games `ok`, worst **0.9878 (hilo)** < 1.0. gam-10 is a
  zero-sum transfer, gam-13 void-only, gsrv-5 void-only — no payout, win chance
  or guard was loosened.
- **Atomicity**: `verify-atomic-economy` 16/16, `restore: EXACT`. No atomic SQL
  increment was replaced with a read-modify-write; the two new guards are
  optimistic re-reads layered on top, and `ensureProgress` uses
  `ON CONFLICT DO NOTHING` rather than an absolute write.