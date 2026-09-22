# agent-16 games-server audit

Scope: `src/lib/gamification/games.ts`, `src/app/api/games/play/route.ts`, `src/app/api/games/symbols/route.ts`.
All read-only. Line numbers are from the current working tree.

## gsrv-1: Scratch pays 20x on a ~12.6% event — negative house edge (+152% EV per round)
- **Severity**: critical
- **Side**: server
- **File**: src/lib/gamification/games.ts:373-376
- **Evidence**:
  ```ts
  // Rare jackpot triple: three dedicated jackpot symbols
  const jackpot = (counts.get("jackpot") ?? 0) >= 3;
  if (jackpot) mult = 20;
  return { payout: Math.floor(bet * mult), result: { cells, mult, jackpot } };
  ```
  plus `scratchSymbol()` picks uniformly from 7 symbols (games.ts:468-471).
- **Why it is a bug**: 9 cells are drawn uniformly from a 7-symbol alphabet, so the count of the `jackpot` symbol is `Binomial(9, 1/7)` and `P(count>=3) = 1 - (P0+P1+P2) ≈ 0.126`. Roughly one round in eight pays `20 * bet`, i.e. an expected payout of `≈2.52 * bet` before the regular-triple contributions (`count===3 ? 2 : 6`) are even added. The comment says the triple is "rare"; it is the single most common win. Exploit: `POST /api/games/play {"game":"scratch","bet":1000}` repeatedly; expected profit ≈ +1520 coins/round, and the 1s flood check allows 3600 rounds/hour.
- **Confidence**: confirmed
- **Fix direction**: weight the jackpot symbol far lower (or require all three jackpot cells drawn from a separate low-probability roll), and recompute the table so total EV < 1.

## gsrv-2: Every "skill" resolver trusts a client-reported score — `matches:3` is a guaranteed 3x
- **Severity**: critical
- **Side**: server
- **File**: src/lib/gamification/games.ts:352-359 (vault), 237-247 (shoot), 249-262 (memory), 264-274 (quiz), 395-404 (catcher)
- **Evidence**:
  ```ts
  case "vault": {
    const matches = clampInt(input.matches, 0, 3);
    const mult = [0, 0.5, 1.5, 3][matches];
    const payout = Math.floor(bet * mult);
    return { payout, result: { matches, mult, perfect: matches === 3 } };
  }
  ```
  Same shape for the others, e.g. `const correct = clampInt(input.correct, 0, total); ... mult = clamp(ratio * 2.1 - 0.8, -1, 1.2)`.
- **Why it is a bug**: `matches` (and `hits/shots`, `timeMs/misses`, `correct/total`, `caught/missed`) are never derived server-side from any session state; the clamp is the only gate. A client sending `{"game":"vault","bet":2000,"input":{"matches":3}}` gets `payout = 6000` → `+4000 coins` per round deterministically. Quiz (`total:1, correct:1` → mult 1.2 → payout 2.2x), catcher (`caught:400, missed:0` → mult 1.5 → 2.5x) and shoot/memory (`… → mult 1.2`) are all likewise guaranteed-profit with fabricated input.
- **Confidence**: confirmed
- **Fix direction**: skill games need a server-issued challenge token (server knows the correct answers / start time / target) or move the scoring server-side; at minimum treat scores as untrusted and bound the multiplier so EV < 1.

## gsrv-3: Tower — `cashoutAt:1` (and 2) is positive EV
- **Severity**: high
- **Side**: server
- **File**: src/lib/gamification/games.ts:380-391
- **Evidence**:
  ```ts
  const cashoutAt = clampInt(input.cashoutAt ?? 5, 1, 10);
  ...
  const failChance = 0.08 + floor * 0.055;
  if (Math.random() < failChance) { survived = false; break; }
  ...
  const payout = survived ? Math.floor(bet * (1 + cashoutAt * 0.22)) : 0;
  ```
- **Why it is a bug**: for `cashoutAt = 1` the only fail chance is `0.08 + 1*0.055 = 0.135`, so survival is 0.865 while the payout is `1.22 * bet`; EV `= 0.865 * 1.22 = 1.0553 > 1` (+5.5% per round). `cashoutAt = 2` is also +EV (`0.865*0.81*1.44 = 1.0090`). Exploit: play only `{"game":"tower","bet":2000,"input":{"cashoutAt":1}}`; EV ≈ +110 coins/round at 1 round/s.
- **Confidence**: confirmed
- **Fix direction**: raise the floor fail chance above `1 - 1/(1+cashoutAt*0.22)` for low cashout levels (or make payout grow slower than survival odds) so every level has EV < 1.

## gsrv-4: Slots — empty/no-match symbol pool makes every round a guaranteed max payout, and the pool is cached forever
- **Severity**: high
- **Side**: server
- **File**: src/lib/gamification/games.ts:436-455 (and cache at 430/453-455), consumed at 202-234
- **Evidence**:
  ```ts
  let symbolCache: SlotSymbol[] | null = null;
  ... if (symbolCache) return symbolCache;
  const { data } = await supabase.from("badges").select(...).in("slug", preferred).limit(6);
  const rows = (data ?? []) as ...;
  const pool: SlotSymbol[] = rows.map(...);
  pool.push({ id: "scatter", label: "Book of Badges", image: null, weight: 6, value: 1 });
  symbolCache = pool;
  ```
- **Why it is a bug**: `rows` is not checked for emptiness and the preferred slugs include not-yet-existing ones (`subtember-2026-v1`, `wsci-2026-v1`). If the catalog/`badges` table is un-migrated or those slugs are absent, `pool` is just `[{id:"scatter",…}]`, so `weightedSymbol` returns `"scatter"` for all 15 cells. Then every line matches 5-of-a-kind (`count !== 3` → `mult 6`, `amount = bet/5*6`) and `scatter` hits all 5 columns (`payout += bet*20`) ⇒ `payout` is clipped to the `bet * 25` cap on every single round. A permanently-cached wrong pool (`symbolCache`) also survives catalog repairs until the instance recycles. Same pool feeds `/api/games/symbols` and the memory/quiz UI.
- **Confidence**: likely
- **Fix direction**: fall back to a built-in symbol table when `rows.length === 0` (and exclude `scatter` from the line-match alphabet), and skip caching an unfilled pool.

## gsrv-5: 1-second flood check is a non-atomic read — concurrent requests bypass it
- **Severity**: medium
- **Side**: server
- **File**: src/lib/gamification/games.ts:81-93
- **Evidence**:
  ```ts
  const { data: lastRound } = await supabase.from("game_rounds").select("created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (lastRound && Date.now() - new Date(String(lastRound.created_at)).getTime() < RATE_LIMIT_MS) {
    return fail("Slow down — one round per second.");
  }
  ```
- **Why it is a bug**: the check only reads the newest row and the insert happens later (games.ts:105), so two requests fired in parallel both observe the pre-request row and both pass; there is no advisory lock/unique constraint. Combined with gsrv-1/2/3 this multiplies the per-second profit; it also uses strict `<`, so exactly 1000 ms is allowed. A client can parallelize N requests and land N rounds per second.
- **Confidence**: likely
- **Fix direction**: enforce the interval with a DB constraint/atomic guard (e.g. insert conditional on `created_at < now() - 1s` via a unique `(user_id, floor(epoch))` key or an advisory lock) instead of read-then-insert.

## gsrv-6: `streak5` flag granted on a 4-streak (off-by-one)
- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/games.ts:177-179
- **Evidence**:
  ```ts
  if (gameId === "rps" || gameId === "blackjack") {
    return streak >= 4 ? { [`streak5`]: true } : {};
  }
  ```
- **Why it is a bug**: `streak` is counted from the last 5 finished rounds (`.limit(5)`), so `streak >= 4` labels a four-win run as the five-win `streak5` flag; the flag is persisted into `game_rounds.result` and drives the `streak5` achievement/feed. It is also computed before the current round is inserted, so the streak is always one round behind.
- **Confidence**: confirmed
- **Fix direction**: require `streak >= 5` and query the 5 most recent rounds including the one just played.

## Checked, no defect found
- Unknown game id cannot reach `resolveGame`: `playGame` returns `fail("Unknown game.")` at games.ts:71-72 before the switch, and `resolveGame` is module-private (its `default: return { payout: 0 }` at 406-407 is dead code).
- Bet edge cases are rejected: `Math.floor(bet)` then `!Number.isFinite(bet) || bet < min || bet > max` (games.ts:73-76) rejects `NaN`, `±Infinity`, negative and out-of-range; fractional bets floor into range. The route additionally requires `typeof body.bet === "number"` (route.ts:13).
- rps (`choices.includes`, 193), roulette (`["red","black","green"].includes`, 319), coinflip (`target` 1-7, `side` heads/tails, 277-289) and hilo (`guess` lower/higher, 307) validate their choice inputs, and all outcomes are `Math.random()`-rolled server-side.
- Round insert order is safe: `game_rounds.insert` (105-113) runs before `bump_counters`/`bumpCoins` (118-129), so a failed insert throws without moving the balance.
- Daily XP cap: the only games path calls `award(..., countsAsGameXp: true)` (games.ts:131-141). Whether the cap itself is enforced lives in `xp.ts`, which is outside this scope — **unconfirmed**.
