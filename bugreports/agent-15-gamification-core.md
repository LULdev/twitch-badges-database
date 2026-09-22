# Agent 15 — gamification-core audit

Scope: `src/lib/gamification/{xp,levels,achievements,daily,wheel,games,visits,session}.ts`,
`supabase/migrations/0006_hardening_atomic_counters.sql`, `0007_atomic_counters_gates.sql`.
Read-only audit; no code changed.

## Priority hypothesis — verified, with one correction

`award()` (xp.ts:145-215) strips only four columns from the snapshot it upserts:

```ts
const {
  xp: _previousXp,
  coins: _previousCoins,
  game_xp_today: _previousGameXp,
  game_xp_day: _previousGameXpDay,
  ...currentWithoutBalance
} = current;                                    // xp.ts:192-198
await supabase.from("user_progress")
  .upsert({ ...currentWithoutBalance, ...patch }, { onConflict: "user_id" }); // xp.ts:209-214
```

`getProgress()` reads `select("*")` (xp.ts:84-88), so `currentWithoutBalance` still contains
**every** counter and gate column, and a Supabase `upsert` with `onConflict` compiles to
`INSERT … ON CONFLICT (user_id) DO UPDATE SET <every column in the payload>` — the values read
at the start of `award()` are written back over whatever is in the row at write time. The
columns still written by the upsert that migration 0007 declares atomically owned:

- counters (0007:21-37, `bump_counters`): `games_played`, `games_won`, `coins_won`, `coins_lost`,
  `wheel_spins`, `steals_successful`, `steals_failed`, `times_robbed`, `achievements_points`
- daily gate (0007:46-75, `claim_daily_gate`): `login_streak`, `best_login_streak`, `last_login_date`
- wheel gate (0007:80-97, `claim_wheel_gate`): `last_wheel_date`, `wheel_spins`
- derived: `level` (recomputed from `newXp`), `created_at` (spread back, harmless)

Correction to the hypothesis: in every in-file caller the counter RPCs run **before** `award()`
(games.ts:118 → 131; daily.ts:18 → 30; wheel.ts:47 → 62), and `award()` re-reads progress at its
own start, so the same request cannot clobber its own increments. The clobber is a **cross-request**
one: any atomic write that lands between `getProgress()` and the upsert is reverted. Because these
RPCs exist precisely to survive concurrency (0006:11-13, 0007:6-13), that is a regression of the
stated fix, not a theoretical one — see gam-1.

## gam-1: `award()` upsert reverts concurrent counter/gate increments (re-opens the daily gates)

- **Severity**: critical
- **Side**: server
- **File**: src/lib/gamification/xp.ts:192-215 (+ evidence in daily.ts:18, wheel.ts:47, games.ts:118)
- **Evidence**:

```ts
// xp.ts:150,192-215 — snapshot taken here, full row written back later
const current = await getProgress(userId);
const { xp, coins, game_xp_today, game_xp_day, ...currentWithoutBalance } = current;
await supabase.from("user_progress").upsert({ ...currentWithoutBalance, ...patch }, { onConflict: "user_id" });
```

```sql
-- 0007:54-62 — the only writer of last_login_date
update public.user_progress set login_streak = …, last_login_date = p_today …
 where user_id = p_user_id and last_login_date is distinct from p_today;
```

- **Why it is a bug**: the daily-claim request and a game/achievement award run as two independent
  serverless invocations of the same user. Interleaving: (1) award's `getProgress()` reads
  `last_login_date = NULL`, `wheel_spins = 4`; (2) the concurrent `claim_daily_gate` sets
  `last_login_date = today`, `login_streak = 1`; (3) award's upsert writes `last_login_date = NULL`
  and `wheel_spins = 4` back. Result: the streak/date update is silently undone, and because the
  gate predicate is `last_login_date is distinct from p_today`, **the daily bonus can be claimed
  again** (same for `claim_wheel_gate` / `last_wheel_date` → a second wheel spin, up to a Turbo
  jackpot roll). `games_played/coins_won/…` are reverted the same way, so the counters the new
  RPCs were introduced to make safe still lose increments — exactly the defect 0006/0007 claim to
  have fixed. Same mechanism writes a stale `level` (see gam-7).
- **Confidence**: likely (columns written = confirmed; the loss needs the interleaving above)
- **Fix direction**: make the trailing write a narrow `update({ level, updated_at })` on the
  columns `award()` owns, or move the level computation into a SQL function and stop reading a
  whole row; never spread a snapshot into an upsert of an atomic-counter table.

## gam-2: `getProgress()` swallows read errors and returns an all-zero row — `award()` then wipes the account

- **Severity**: high
- **Side**: server
- **File**: src/lib/gamification/xp.ts:82-117
- **Evidence**:

```ts
const { data } = await supabase.from("user_progress").select("*").eq("user_id", userId).maybeSingle();
if (data) return data as ProgressRow;
const inserted = await supabase.from("user_progress")
  .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true }).select("*").eq("user_id", userId).maybeSingle();
return (inserted.data ?? { user_id: userId, xp: 0, coins: 0, level: 1, login_streak: 0, … }) as ProgressRow;
```

- **Why it is a bug**: the select error is never inspected. If the first read fails or returns
  nothing for an existing row, `ignoreDuplicates` makes the follow-up insert a no-op *with no rows
  returned* (`maybeSingle()` → `null`), so the function hands back the zeroed literal. `award()`
  then upserts that literal (only xp/coins are stripped): `level=1`, `games_played=0`,
  `games_won=0`, `coins_won/coins_lost=0`, `wheel_spins=0`, `steals_successful=0`,
  `steals_failed=0`, `times_robbed=0`, `achievements_points=0`, `login_streak=0`,
  `best_login_streak=0`, `last_login_date=NULL`, `last_wheel_date=NULL` — lifetime progress and
  both daily gates are destroyed in one write (`buildStats` then reads that zeroed row too, so
  achievement checks are evaluated against a wiped profile).
- **Confidence**: likely (mechanism confirmed in code; needs one failed/empty read)
- **Fix direction**: check `error` and throw; never return a synthetic row that a caller can
  upsert back — return a `null`/default that callers cannot spread into a write.

## gam-3: client-reported `input.matches` pays 3× in `vault` (and `cashoutAt` gives a positive-EV `tower`)

- **Severity**: high
- **Side**: server
- **File**: src/lib/gamification/games.ts:352-360 (vault), :379-393 (tower), :65-70 + src/app/api/games/play/route.ts:16
- **Evidence**:

```ts
case "vault": {
  const matches = clampInt(input.matches, 0, 3);
  const mult = [0, 0.5, 1.5, 3][matches];
  const payout = Math.floor(bet * mult);
  return { payout, result: { matches, mult, perfect: matches === 3 } };
}
```

```ts
case "tower": {
  const cashoutAt = clampInt(input.cashoutAt ?? 5, 1, 10);
  … const payout = survived ? Math.floor(bet * (1 + cashoutAt * 0.22)) : 0;
}
```

- **Why it is a bug**: `resolveGame` is the whole authority — there is no server-side vault state
  to verify `matches`, no randomness, no house edge: a crafted `POST /api/games/play
  {"game":"vault","bet":2000,"input":{"matches":3}}` pays 6000 for free (max bet 2000, rate
  limited to 1/s ⇒ ~4000 coins/second of minted coins). `tower` is a client-chosen
  `cashoutAt` with server randomness: `cashoutAt=1` pays 1.22× with p=0.865 ⇒ EV = 1.055×bet
  (positive), so always-cash-out-at-1 is a guaranteed profit loop; `cashoutAt=2` is ~1.009×.
  Every other skill game is bounded to +20% (`mult` clamped to 1.2 / `caught*0.012` etc.); these
  two are not.
- **Confidence**: confirmed (for `vault`; the tower EV is arithmetic on the same constants)
- **Fix direction**: resolve vault server-side (store the combination per round and pay only the
  matches the client could have seen), and give `tower` a house-edge payout table whose EV < 1 for
  every `cashoutAt` (or remove the client's choice of multiplier).

## gam-4: a duplicate achievement row still pays its XP/coins (double award under concurrency)

- **Severity**: medium
- **Side**: server
- **File**: src/lib/gamification/achievements.ts:266-303
- **Evidence**:

```ts
const { error } = await supabase.from("user_achievements")
  .upsert({ user_id: userId, achievement_id: id }, { onConflict: "user_id,achievement_id" });
if (error) continue;                    // merge-duplicates: no error on an existing row
…
await supabase.rpc("bump_counters", { p_user_id: userId, p_deltas: { achievements_points: ach.points } }) …
await award(userId, { xp: ach.xp, coins: ach.coins, source: `achievement:${id}`, skipAchievements: true })…
```

- **Why it is a bug**: `upsert` with `onConflict` is `ON CONFLICT DO UPDATE`, so re-unlocking an
  existing achievement returns **no error** and the body continues to `bump_counters` and `award`.
  Two overlapping `evaluateAchievements` runs for one user (e.g. a game round and a wheel spin
  firing together — every caller does its own `evaluateAchievements`) both compute the same
  `newly` list from the same unlocked set and both pay `ach.xp`/`ach.coins`/`ach.points`, plus a
  duplicated feed entry. Unlike the gates fixed in 0007, unlock is not a compare-and-set.
- **Confidence**: likely (mechanism confirmed; needs two concurrent evaluations)
- **Fix direction**: use a plain `insert()` and treat SQLSTATE 23505 (or `error.code === "23505"`)
  as "already unlocked", skipping the reward; or make the unlock+reward one SQL function.

## gam-5: meta-achievement threshold counts other meta-achievements (unlocks one early)

- **Severity**: medium
- **Side**: server
- **File**: src/lib/gamification/achievements.ts:240-264
- **Evidence**:

```ts
const unlocked = new Set(…achievement_id…);        // includes c_ach_1 … c_ach_100
const totalUnlocked = unlocked.size + newly.length;
for (const meta of META_ACHIEVEMENTS) {
  if (!unlocked.has(meta.id) && totalUnlocked >= meta.at) newly.push(meta.id);
}
```

- **Why it is a bug**: `unlocked` mixes real achievements with the five meta ("unlocked N
  achievements") achievements, so a user holding 9 real achievements plus `c_ach_1` has
  `unlocked.size = 10` and receives `c_ach_10` ("Achievement Hunter — Unlock 10 achievements",
  +150 XP/+150 coins) one achievement early; the effect compounds for `c_ach_25/50/100`
  (each unlocks ~2 early). The counter feeding the reward is inflated by the rewards themselves.
- **Confidence**: confirmed
- **Fix direction**: count only non-`c_ach_` ids: `const realUnlocked = [...unlocked].filter(id => !id.startsWith("c_ach_")).length + newly.length;`

## gam-6: `bump_counters` / `bump_view_count` RPC errors are ignored — silent counter drift on a "won" round

- **Severity**: medium
- **Side**: server
- **File**: src/lib/gamification/games.ts:118-126; daily.ts:147-160; achievements.ts:276-281; visits.ts:38
- **Evidence**:

```ts
await supabase.rpc("bump_counters", { p_user_id: userId, p_deltas: { games_played: 1, games_won: …, coins_won: …, coins_lost: … } });
if (net !== 0) await bumpCoins(userId, net);      // games.ts:118-129 — error never checked
```

```ts
await supabase.rpc("bump_view_count", { p_profile_id: profileId });   // visits.ts:38
return true;                                                          // reported as counted regardless
```

- **Why it is a bug**: `bumpCoins` (and `apply_xp_coins`) throw on error, but every
  `bump_counters`/`bump_view_count` call drops the returned `{ error }`. If the incremental update
  fails (row missing, statement timeout, connection reset) the coin balance and `game_rounds` row
  move while `games_played/games_won/coins_won/coins_lost` (or `steals_*`, `times_robbed`,
  `achievements_points`, `profiles.view_count`) do not; `playGame` still returns
  `ok: true, won: true, payout` and the route answers 200, so the drift is undetectable and
  permanent. `recordProfileVisit` even returns `true` ("counted") after a failed counter write.
- **Confidence**: confirmed (code path); impact needs a failing RPC
- **Fix direction**: destructure and throw (or retry) on `error` for each RPC, matching
  `bumpCoins`; in `visits.ts` return `false`/propagate when the bump fails.

## gam-7: `consume_game_xp` burns the daily budget before the XP is applied; level can be written backwards

- **Severity**: medium
- **Side**: server
- **File**: src/lib/gamification/xp.ts:158-215
- **Evidence**:

```ts
const consumed = await supabase.rpc("consume_game_xp", { …, p_requested: xpAwarded }); // commits the spend
if (consumed.error) throw consumed.error;
xpAwarded = Number(consumed.data ?? 0);
…
const applied = await supabase.rpc("apply_xp_coins", { p_user_id: userId, p_xp: xpAwarded, p_coins: coinsAwarded });
if (applied.error) throw applied.error;      // budget already spent, XP never granted
…
const after = levelFromXp(newXp).level;      // newXp from apply_xp_coins
…  .upsert({ ...currentWithoutBalance, ...patch })   // patch.level = after
```

- **Why it is a bug**: two failure modes in one non-transactional sequence. (a) If
  `apply_xp_coins` or the trailing upsert fails, `consume_game_xp` has already deducted the XP from
  the 100-per-day budget, so the user's remaining game XP for the day is gone without any XP, and
  the round/coin writes that preceded `award()` stay committed while the client receives a 500
  (a round that is recorded as won but reported as an error → retry plays a second round).
  (b) `before` is derived from the snapshot read at :150 while `after` comes from the RPC result,
  and `level` is written by the same clobbering upsert (gam-1): a concurrent award that raises the
  level between read and write is reverted in the `level` column, so `level` can disagree with
  `xp` until the next award (the UI reads the stored `level`), and `leveledUp`/the "reached level N"
  feed entry can be emitted twice.
- **Confidence**: confirmed (ordering is plain in the code); effect (a) needs one failing write
- **Fix direction**: fold consume + apply + level into one SQL function (or refund the consumed
  budget on failure), and derive both `level` and `leveledUp` inside that same statement.

## gam-8: `attemptSteal` returns a balance computed from the pre-steal snapshot

- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/daily.ts:98-99, 147, 182-183
- **Evidence**:

```ts
const thief = await getProgress(thiefId);      // :98 — snapshot
…
await bumpCoins(thiefId, -settings.price + stolen);   // :147 — return value discarded (true balance)
…
const balance = Math.max(0, thief.coins - settings.price + stolen);   // :182
```

- **Why it is a bug**: the atomic RPC's authoritative new balance is thrown away and the response
  is recomputed from a read taken before the flood checks and before the victim's row was touched.
  Any award that landed in between (a game resolving in another tab, an achievement payout from the
  `evaluateAchievements` calls in this same request) makes the balance the UI shows wrong; the
  `Math.max(0, …)` also masks it as 0 when the real balance is positive.
- **Confidence**: confirmed
- **Fix direction**: `const balance = await bumpCoins(thiefId, -settings.price + stolen);` and return that.

## gam-9: daily-gate RPCs assume the progress row exists and report "already claimed" when it does not

- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/daily.ts:18-24; wheel.ts:47-54 (+ 0007:54-67, 0007:88-93)
- **Evidence**:

```ts
const streak = Number(claimed.data ?? -1);
if (streak < 0) return { ok: false, reason: "already" };      // daily.ts:23-24
if (!gate.data) return { ok: false, reason: "already" };      // wheel.ts:52-54
```

- **Why it is a bug**: `claim_daily_gate`/`claim_wheel_gate` only `UPDATE`; with no `user_progress`
  row the update matches 0 rows and they return `-1`/`false`, which the callers translate into
  "already claimed". `POST /api/daily/claim` and `/api/wheel/spin` call the gate before anything
  creates the row, so a user whose first gamification action is the daily claim or the wheel is
  denied the reward for that day and told they already collected it (only a prior `getProgress()`
  elsewhere — e.g. rendering the profile page — hides this).
- **Confidence**: unconfirmed (needs the route/session order; the SQL has no INSERT fallback)
- **Fix direction**: `insert … on conflict (user_id) do nothing` before the gate, or make the gate
  functions `insert … on conflict (user_id) do update …` and return a distinct "no row" code.

## gam-10: the steal attempt cost is burned on a successful heist, contradicting its own comment

- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/daily.ts:143-160
- **Evidence**:

```ts
// Thief pays the attempt cost; the victim keeps it. …
await bumpCoins(thiefId, -settings.price + stolen);
await bumpCoins(victimProfile.id, -stolen + (success ? 0 : settings.price));
```

- **Why it is a bug**: on a successful heist the victim's delta is `-stolen` only — the `price` the
  thief paid is removed from the economy instead of being credited to the victim as the comment
  (and the anti-abuse design: paying to harass has to *benefit* the victim) states. Net supply
  effect per success is `-price`, a deflationary sink whose size the victim controls via
  `steal_price`.
- **Confidence**: likely (intent read from the in-code comment; the delta math is confirmed)
- **Fix direction**: credit the victim `-stolen + settings.price` on both outcomes (or correct the
  comment and rebalance `steal_price` deliberately).

## gam-11: achievement checks whose description does not match the 60-round window

- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/achievements.ts:153, 218, 425 (+ buildStats window :321)
- **Evidence**:

```ts
CREATIVE("k_cautious", "Cautious Gambler", "Win 10 games without ever betting more than 10 coins.",
  (s) => s.progress.games_won >= 10 && s.maxBet <= 10),
SPECIAL("s_hattrick", "Hat-Trick", "Win three different games within 10 minutes.",
  (s) => s.recentResults.filter((r) => r.won).length >= 3 && s.recentResults.length >= 3),
maxBet: Math.max(0, ...recentRounds.map((r) => r.bet)),     // recentRounds = last 60 rounds only
```

- **Why it is a bug**: condition (1) uses `maxBet` computed over the last 60 rounds, so "never bet
  more than 10" is satisfied by 60+ rounds of small bets after a history of 5,000-coin bets;
  condition (2) drops both the "different games" and the "within 10 minutes" constraints (any 3
  wins among the last 60 rounds, e.g. the same game a week apart). Both award XP/coins for
  behaviour that never happened.
- **Confidence**: confirmed (code vs. description)
- **Fix direction**: compute lifetime maxima/minima in SQL (or a view) and check time distance and
  game distinctness in `s_hattrick`.

## gam-12: vacuous condition in `c_showcase_set`

- **Severity**: low
- **Side**: shared
- **File**: src/lib/gamification/achievements.ts:128
- **Evidence**: `COMMON("c_showcase_set", "Curator", "Fill your badge showcase.", (s) => s.customizationKeys >= 0 && s.badgesOwned >= 1)`
- **Why it is a bug**: `customizationKeys >= 0` is always true (`Object.keys().length` is ≥ 0), so
  "Curator" fires on the first owned badge — a duplicate of `c_sync_first` with a misleading
  description; the showcase is never inspected.
- **Confidence**: confirmed
- **Fix direction**: check the actual showcase field (e.g. `customization.showcase?.length >= N`).

## gam-13: 5-minute/6-per-hour steal flood checks are check-then-insert with no unique constraint

- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/daily.ts:104-141
- **Evidence**:

```ts
const { count: recentPair } = await supabase.from("steal_attempts").select("id", { count: "exact", head: true }) …
if ((recentPair ?? 0) > 0) return { ok: false, error: "Flood check: wait 5 minutes …" };
…
const { error: attemptError } = await supabase.from("steal_attempts").insert({ … });
```

- **Why it is a bug**: the check and the insert are separate statements with no lock and no
  uniqueness on `(thief_id, victim_id, window)`, so a burst of parallel requests all read
  `count = 0` and all insert; the rate limits that protect the victim (up to `steal_max` per
  attempt, 6/hour) are bypassable by concurrency, which is exactly the class of race 0003-0007
  fixed elsewhere. `recordProfileVisit`/`recordBlogView` (visits.ts:16-27, :49-57) have the same
  check-then-insert shape for the 5-minute view dedup.
- **Confidence**: likely
- **Fix direction**: enforce the window in SQL (unique partial index on
  `(thief_id, victim_id, date_trunc('…'))`, or a `claim_steal_gate` compare-and-set like 0007).

## Checked and refuted (no defect found)

- **100 XP/day game cap bypass**: `consume_game_xp` (0007:106-142) clamps under `SELECT … FOR UPDATE`
  to `least(p_requested, 100 - spent)`, is called on every game award (`countsAsGameXp: true`,
  games.ts:134), and `game_xp_today`/`game_xp_day` are the two columns `award()` strips from its
  upsert (xp.ts:195-197) — no bypass found in scope. (Non-game XP — wheel, daily, achievements —
  is intentionally outside the cap.) Caveat: a failing write after the consume burns the budget
  without granting the XP (gam-7a).
- **Achievement-recursion / double evaluation**: `evaluateAchievements` rewards via
  `award(…, { skipAchievements: true })` (achievements.ts:294-302), so no recursion.
- **UTC-boundary handling of the daily gates**: every date is UTC
  (`new Date().toISOString().slice(0, 10)` in xp.ts:154/daily.ts:13/wheel.ts:49, compared against
  `date` params and `p_today - 1` in 0007) — no local-time mixing found.
- **`levels.ts`**: `xpToAdvance`/`levelFromXp` are deterministic, clamp at 100, and agree with the
  SQL-free callers; `levelFromXp(newXp)` uses the post-RPC XP (only the `level` *write* is unsafe,
  gam-1/gam-7).
- **`visits.ts` view counter**: now `bump_view_count` (atomic, 0006:47-54) — no read-modify-write
  remains (the ignored error is gam-6).
