# Gamification core (XP, levels, achievements, daily, wheel, visits)

Audited: `src/lib/gamification/{xp,levels,achievements,daily,wheel,visits,session}.ts`,
`src/app/api/daily/claim/route.ts`, `src/app/api/wheel/spin/route.ts`,
`src/app/api/progress/route.ts`, `src/app/api/feed/route.ts`,
`src/app/api/coinrain/route.ts`, `src/lib/settings.ts`,
`src/components/{WheelOfFortune,DailyClaim,CoinRainButton}.tsx`,
`src/components/games/useGame.tsx`, `src/app/[locale]/{wheel,faq}/page.tsx`,
`src/app/[locale]/profile/[username]/page.tsx` (reading only),
`supabase/migrations/{0003,0006,0007,0014,0015,0017,0018,0019,0020}.sql`,
`messages/*.json` (level-curve copy).

Method: read the modules and the SQL they call; `npx eslint` on the scoped paths
(0 errors, 2 warnings); read-only `SELECT`s against the live database through
`SUPABASE_DB_URL` with `node -e` + `postgres` (function signatures, grants,
`user_progress` level/coin invariants, badge `first_seen_at`/rarity distribution,
`user_achievements`/`activity_events` shape). Could not run `npx tsc --noEmit`
whole-project (not needed — eslint reports no errors in scope) and could not
create >1000 rows to prove B8.

Context: the earlier 20-agent round (`bugreports/agent-15-gamification-core.md`)
and its fix round (`bugreports/fix-c-gamification.md`) settled gam-1…gam-13. This
report does **not** repeat those; live checks confirm the fixes hold (all nine
economy RPCs exist with the expected signatures and none is EXECUTE-able by
`anon`/`authenticated`; no `user_progress` row has a stored `level` that
disagrees with `levelFromXp(xp)`; `game_xp_today <= 100`; no negative coins).

## B1 — `k_marathon_day` ("Play 100 rounds in a single day") can never unlock

- **Severity**: medium
- **Confidence**: high (verified by reading + arithmetic)
- **Where**: `src/lib/gamification/achievements.ts:164` (+ the window at `:422`, `:517-518`)
- **Code**:
```ts
CREATIVE("k_marathon_day", "Marathon", "Play 100 rounds in a single day.", (s) => s.roundsToday >= 100, 750, 500),
```
```ts
// :422 — the ONLY source of roundsToday is a 60-row window
supabase.from("game_rounds").select("game,won,bet,payout,result,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
// :517-518
const rawRounds = (roundsRes.data ?? []) as Array<Record<string, unknown>>;
const roundsToday = rawRounds.filter((r) => String(r.created_at).slice(0, 10) === todayStr).length;
```
- **Why it is wrong**: `roundsToday` is derived exclusively from the 60-most-recent
  rounds, so it is bounded by 60 and `>= 100` is unsatisfiable. The achievement
  (750 XP + 500 coins, CREATIVE) is permanently locked — exactly the "a locked
  entry that can never unlock is a lie in the UI" case the module cites when it
  retires `k_faq_scholar`. A daily 100-round grind reached on a fresh account (no
  other rounds) still reports `roundsToday = 60`.
- **How to reproduce**: by inspection: play 100 rounds in one UTC day; every
  `evaluateAchievements` run reads at most 60 `game_rounds` rows, so
  `roundsToday <= 60` and the predicate never passes.
- **Suspected cause**: the 60-row "recent rounds" window (correct for streaks and
  `s_hattrick`) was reused for a count that needs a full-day query.

## B2 — `k_retro_2017` ("Time Traveler") measures catalog detection year, so it can never unlock

- **Severity**: medium
- **Confidence**: high (verified by reading + live query)
- **Where**: `src/lib/gamification/achievements.ts:181` (+ `:413` select, `:481-483`, `:564`)
- **Code**:
```ts
// :413 — the select does not include release_date / start_date / end_date
supabase.from("user_inventory").select("badges(rarity_tier,status,set_id,first_seen_at,rarity_score)").eq("user_id", userId),
// :481-483
const oldestYear = firstSeens.length
  ? new Date(firstSeens[0]).getUTCFullYear()
  : 9999;
// :181
CREATIVE("k_retro_2017", "Time Traveler", "Own a badge from 2017 or earlier.", (s) => s.oldestBadgeYear <= 2017),
```
- **Why it is wrong**: `oldestBadgeYear` is the year this database first *detected*
  the badge (`badges.first_seen_at`), not the badge's release/`start_date`. Live:
  `select min(first_seen_at) from badges` = `2026-09-20` over all 476 rows, so
  `oldestYear` is 2026 for every possible inventory and `<= 2017` is false for
  ever. "Own a badge from 2017 or earlier" is therefore unreachable (500 XP +
  250 coins permanently locked), and the same mis-sourced value means the check
  would fire for a badge *added to the catalog* in 2017, not one from 2017.
- **How to reproduce**: by inspection + live read-only query:
  `select min(first_seen_at), count(*) from badges` → `2026-09-20, 476`.
  (Live catalog also holds 0 badges with `release_date < 2018`, so even the
  intended semantic is unsatisfiable today — but the field used is wrong
  regardless.)
- **Suspected cause**: `first_seen_at` (a detection timestamp) was used where a
  badge-age field was meant; `k_fresh_drop` correctly wants detection, this one
  does not.

## B3 — The level-curve copy is wrong in all 11 locales (claims 254,900 XP; the curve yields 252,450)

- **Severity**: low
- **Confidence**: high (verified by computing and by reading the copy)
- **Where**: `messages/*.json:672` (`faq.levelsA`), vs `src/lib/gamification/levels.ts:15-23`
- **Code**:
```ts
export function xpToAdvance(level: number): number {
  return 100 + (Math.max(1, Math.min(100, level)) - 1) * 50;
}
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l += 1) total += xpToAdvance(l);
  return total;
}
```
```
// messages/en.json (identical claim in ar, de, es, fr, it, ja, ko, pt, ru, zh):
"levelsA": "Level 1 starts at 0 XP. Each level needs 100 + (level-1) x 50 XP — level 100 totals 254,900 XP. …"
```
- **Why it is wrong**: the FAQ answer is rendered on `/faq` (`FAQ_KEYS` →
  `answerFor("levels")`, `src/app/[locale]/faq/page.tsx:68-71`) and publishes a
  number that contradicts the implementation: reaching level 100 costs
  `totalXpForLevel(100)` = **252,450** XP (99 advances), and *completing* level
  100 costs 257,500. 254,900 matches neither, in all eleven locales. The same page
  templates the achievement counts precisely to stop this kind of drift
  (`achievementsA` + `achievementCounts`, lines 58-71), so the level total is the
  one hand-written figure that has drifted.
- **How to reproduce**: `node -e` summing `xpToAdvance(1..99)` → 252450; grep the
  literal in `messages/` → present in all 11 locale files.
- **Suspected cause**: hand-written copy with no test binding it to `levels.ts`.

## B4 — The daily/wheel gate is consumed before the reward is persisted; a failed award loses the day and the retry is refused

- **Severity**: medium
- **Confidence**: medium (mechanism fully confirmed in code; the failure itself is a transient RPC error)
- **Where**: `src/lib/gamification/daily.ts:27-53`, `src/lib/gamification/wheel.ts:51-74`
- **Code**:
```ts
// daily.ts:27-53 — gate commits the streak/date BEFORE any reward is written
const claimed = await supabase.rpc("claim_daily_gate", { p_user_id: userId, p_today: todayStr });
if (claimed.error) throw claimed.error;
const streak = Number(claimed.data ?? -1);
if (streak < 0) return { ok: false, reason: "already" };
…
await award(userId, { xp, coins, source: "daily", … });   // may throw; gate already committed
```
```ts
// wheel.ts:51-74 — same shape: the gate also increments wheel_spins
const gate = await supabase.rpc("claim_wheel_gate", { p_user_id: userId, p_today: today() });
if (gate.error) throw gate.error;
if (!gate.data) return { ok: false, reason: "already" };
…
await award(userId, { xp: slot.xp, coins: slot.coins, source: "wheel", … });
```
- **Why it is wrong**: `claim_daily_gate`/`claim_wheel_gate` commit atomically
  (0007), but they are a *separate* transaction from the reward. If `award()`
  throws — `getProgress` read failure, `apply_xp_coins` statement timeout — the
  route has no `try/catch`, so the client gets a 500 *after* `last_login_date` /
  `last_wheel_date` (and `wheel_spins`) are already advanced. The user's bonus /
  spin prize for that UTC day is gone and a retry is answered `already` (429), so
  there is no recovery path. `wheel_spins` (used by `c_wheel_10`, `c_wheel_50`,
  `s_wheel_misfortune`) is incremented with nothing paid.
- **How to reproduce**: by inspection; or force `apply_xp_coins` to fail (e.g.
  statement timeout) and observe `last_login_date = today` with no XP/coins and a
  429 on the retry.
- **Suspected cause**: reward persistence and the gate are two RPCs; only the
  game-XP path was folded into one statement (B-fix from the earlier round).

## B5 — The steal race recheck hardcodes "6/hour" while the hourly limit is configurable

- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/gamification/daily.ts:181`
- **Code**:
```ts
const { count: racedHour } = await supabase
  .from("steal_attempts").select("id", { count: "exact", head: true })
  .eq("thief_id", thiefId).gte("created_at", hourAgo);
if ((racedPair ?? 0) > 1 || (racedHour ?? 0) > 6) {   // 6 is hardcoded
  … return { ok: false, error: "Flood check: too many attempts at once." };
}
```
- **Why it is wrong**: the authorised limit is read from settings earlier
  (`if ((recentHour ?? 0) >= economy.stealPerHour)`, `:138`, default 6, but
  `stealPerHour` is an admin-editable `EconomySettings` field merged by
  `settings.ts`). The post-insert race check ignores it. If an operator raises
  `stealPerHour` to, say, 20, then a legitimate 7th attempt inside the hour (the
  pre-check allows it) is inserted, then **voided** and reported as "too many
  attempts at once"; if they lower it to 3, the burst guard still tolerates up to
  6, defeating the setting. The two branches must use the same bound.
- **How to reproduce**: by inspection. Also reproducible at runtime by setting
  `economy.stealPerHour = 20` (admin panel) and making 7 sequential in-window
  attempts: the 7th returns the flood error.
- **Suspected cause**: the default `6` was inlined when the race guard was added.

## B6 — `k_night_owl` / `k_early_bird` test the evaluation clock, not the daily-claim time

- **Severity**: low
- **Confidence**: high (verified by reading; eslint flags the unused `s` in both)
- **Where**: `src/lib/gamification/achievements.ts:156-157`
- **Code**:
```ts
CREATIVE("k_night_owl", "Night Owl", "Claim a daily bonus between 0 and 5 AM.", (s) => new Date().getUTCHours() < 5),
CREATIVE("k_early_bird", "Early Bird", "Claim a daily bonus before 7 AM UTC.", (s) => new Date().getUTCHours() < 7 && new Date().getUTCHours() >= 5),
```
- **Why it is wrong**: both predicates ignore their stats argument and read the
  wall clock at *evaluation* time. `evaluateAchievements` runs on every award —
  a game round, a wheel spin, a steal, a coin rain, another achievement — so any
  of those between 00:00 and 07:00 UTC unlocks "Claim a daily bonus between 0 and
  5 AM" without any daily bonus being claimed. Live evidence of the timing axis:
  the only `user_progress` account unlocked `k_night_owl` at `2026-09-22T01:25:59Z`
  inside a chain where the daily claim happened a second earlier — nothing ties
  the predicate to that claim. The correct signal is the claim itself (e.g. the
  `daily` feed `payload`/`created_at`), not `Date.now()`.
- **How to reproduce**: by inspection; or play one game at 03:00 UTC without
  claiming the daily and watch `k_night_owl` unlock.
- **Suspected cause**: the check was written as a time-of-day test with no
  reference to the event that is supposed to have happened at that time.

## B7 — `/api/feed` ignores the `features.feed` switch

- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/app/api/feed/route.ts:6-40` (no `getFeatures()` call)
- **Code**:
```ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  …
  let query = supabase.from("activity_events").select("id,username,avatar_url,kind,title,body,xp_amount,coins_amount,created_at").order("id", { ascending: false }).limit(limit);
  … // no feature gate
```
- **Why it is wrong**: `features.feed` is a real operator switch — the nav entry
  is hidden from it (`src/components/Header.tsx:57`,
  `...(on("feed") ? [{ href: "/feed", … }] : [])`) — but the endpoint keeps serving
  the full public feed, so turning the feature off only removes the link while the
  data stays reachable at `/api/feed?limit=50`. (This is the "feed flag's page and
  endpoint" item left open by the admin-panel round; the endpoint belongs to this
  scope, the page to another.)
- **How to reproduce**: set `features.feed = false` in the admin panel, then
  `GET /api/feed` → 200 with events.
- **Suspected cause**: the flag was only ever wired into the navigation.

## B8 — Two `activity_events` reads in `buildStats` are unpaged while the rest of the module pages at 1000 rows

- **Severity**: low
- **Confidence**: medium (the module asserts the PostgREST cap; I could not create >1000 rows to observe it)
- **Where**: `src/lib/gamification/achievements.ts:423` and `:460` (vs `pageAll` at `:383-403`)
- **Code**:
```ts
// :423
supabase.from("activity_events").select("xp_amount").eq("user_id", userId).eq("kind", "wheel"),
// :460
supabase.from("activity_events").select("kind").eq("user_id", userId),
```
```ts
// :383-387 — the module's own stated reason for pageAll
 * Read every row of a query in 1000-row pages. PostgREST caps one response at
 * 1000 rows regardless of the requested limit, so an unbounded select silently
 * truncated — and the achievements below aggregate over the whole set.
```
- **Why it is wrong**: the module pages `game_rounds`, `steal_attempts` and both
  `profile_visits` queries precisely because an unpaged select truncates at 1000
  rows, then leaves the two `activity_events` reads unbounded. `activityCount` and
  `dailyCount` (`c_feed_first`, `c_daily_claim_100`) are aggregates over the whole
  event history, so for a member with more than 1000 events the count is a silent
  undercount (the row order is not even specified), and `wheelBest`
  (`k_lucky_2500`, `s_wheel_misfortune`) is computed over a truncated set.
- **How to reproduce**: not reproduced live (the only live account has 20 events).
  By inspection once any account exceeds 1000 `activity_events` rows.
- **Suspected cause**: the two newer reads were added after `pageAll` without it.

## B9 — The wheel payout table exists twice, and the turbo slot's declared weight is 10× its real probability

- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/gamification/wheel.ts:20-31` vs `src/components/WheelOfFortune.tsx:15-24`
- **Code**:
```ts
// wheel.ts:28,31
{ id: "turbo", label: "Twitch Turbo!", xp: 5000, coins: 50000, weight: 0.0000001, turbo: true },
…
const TURBO_PROBABILITY = 0.00000001;
```
```ts
// WheelOfFortune.tsx:15-24 — an independent copy of ids/labels/xp/coins
const SEGMENTS: Slot[] = [ { id: "xp25", label: "+25 XP", xp: 25, coins: 10 }, … { id: "turbo", label: "TURBO", xp: 5000, coins: 50000, turbo: true } ];
```
- **Why it is wrong**: two problems from one table. (1) The turbo slot's `weight`
  is `1e-7` while the actual draw is `Math.random() < 1e-8` and the slot is
  excluded from `weightedPick` (`slice(0, -1)`), so the field is dead *and* wrong
  by 10× — any consumer that derives odds from `WHEEL_SLOTS` (the shape suggests
  it is the source of truth) would publish 1 : 10,000,000, the opposite of the
  `turboOdds` copy the UI shows. (2) The client keeps a byte-for-byte duplicate of
  the payout table; the server sends only the slot `id` and the client resolves
  the displayed coins from its own copy, so any server payout change silently
  makes the client display the old amount.
- **How to reproduce**: by inspection (grep `WHEEL_SLOTS` → used only inside
  `wheel.ts`; grep the slot ids → duplicated in `WheelOfFortune.tsx`).
- **Suspected cause**: the client table predates the server table and the turbo
  weight was never wired to the draw.

## Checked and refuted (no defect)

- **Daily/streak UTC arithmetic**: every date is UTC
  (`new Date().toISOString().slice(0,10)` in `xp.ts:193`, `daily.ts:17`,
  `wheel.ts:today()`, compared against `p_today`/`p_today - 1` in 0007). No local
  time anywhere, no timezone mixing; `claim_daily_gate`'s
  `last_login_date is distinct from p_today` predicate is a real compare-and-set.
- **`award()` cross-request clobber (earlier gam-1)**: fixed — the trailing write
  is a narrow `update({ level, updated_at })` and every atomic-owned column is
  destructured out (`xp.ts:250-307`). Live: no stored `level` disagrees with
  `levelFromXp(xp)`.
- **`getProgress()` returning a zeroed row on a failed read (gam-2)**: fixed — both
  reads check `error` and throw (`xp.ts:95,109,117`).
- **100 XP/day game cap**: `consume_and_apply_game_xp` clamps under `FOR UPDATE`
  and applies coins in the same statement (0018); live `game_xp_today <= 100`.
- **Achievement double-pay (gam-4)**: fixed — plain `insert()` + `continue` on the
  23505 (`achievements.ts:336-339`); a PK violation cannot re-pay.
- **Meta-achievement inflation (gam-5)**: fixed — `totalUnlocked` filters
  `c_ach_*` (`achievements.ts:323-324`).
- **Achievement catalog integrity**: 125 entries, exactly 50 common / 50 creative
  / 25 special, zero duplicate ids (extracted mechanically).
- **Achievement rendering of unknown ids**: `ACH_BY_ID` is built from all
  definitions (retired included) and both profile-page call sites guard with
  `if (!achievement) return null` — no crash on an orphan ledger row.
- **`/api/feed` parameters (ind-4)**: absent/non-numeric `limit` → 30, provided →
  clamped 5…50; a non-numeric `cursor` → 0. No NaN reaches the query.
- **`/api/feed` payload exposure**: `payload` and `user_id` are not selected.
- **`/api/coinrain` input**: the client-supplied `profileId` is verified against
  `profiles` before the gate insert (so a bad id is not a 500), self-rain and
  non-existent profiles return `ok:false` with `already:false`, and the gate is a
  PK compare-and-set (`coin_rain_gate(owner_id, giver_key, day)`, 0014) with the
  anonymous key being the 40-char salted IP hash (passes the 8…128 CHECK).
- **`session.ts` IP hash**: prefers `x-real-ip`, otherwise the rightmost
  `x-forwarded-for` entry (spoof-resistant); no literal salt fallback.
- **RPC surface**: all nine gamification RPCs exist with the signatures the code
  calls, and `has_function_privilege('anon'|'authenticated', …)` is false for
  every one (live check).
- **Candidates that are data gaps, not code defects**: no `mythic` badge exists in
  the live catalog (so `k_mythic_own` / `k_all_tiers` are currently unsatisfiable)
  and no badge has `rarity_score >= 90` (`s_endgame`) — the predicates are correct;
  the catalog simply has no such rows yet.
- **`distinctHoursToday` / `recentPerfectFlags`** are computed and never read by a
  check — dead stats, not wrong output.
