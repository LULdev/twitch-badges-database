# games-a — audit of the arcade client games (RPS, Coinflip, Hilo, Roulette, Blackjack)

Scope (read in full): `src/components/games/useGame.tsx`, `RpsGame.tsx`,
`CoinflipGame.tsx`, `HiloGame.tsx`, `RouletteGame.tsx`, `BlackjackGame.tsx`,
plus the server path those files drive (`/api/games/play`, `src/lib/gamification/games.ts`,
`xp.ts`, `achievements.ts`) where it is needed to prove a client/server disagreement.

## games-a-1: Hilo's "current rarity" is a hardcoded 30 while the server rolls its own value
- **Severity**: high
- **Side**: shared
- **File**: `src/components/games/HiloGame.tsx:12` (and `:23`), `src/lib/gamification/games.ts:302`
- **Evidence**:
  ```tsx
  }>({ currentScore: 30 });            // HiloGame.tsx:12 — fixed initial display
  ...
  setState({ currentScore: r.nextScore, actual: r.actual, won: r.won });  // :23
  ```
  ```ts
  const currentScore = Number(
    ((last?.result as Record<string, unknown> | null)?.nextScore as number | undefined) ??
      30 + Math.floor(Math.random() * 40),   // games.ts:302-305 — server picks 30..69
  );
  ```
- **Why it is a bug**: the server's first round compares the player's guess against a
  random 30–69 that the client never learns (`result.currentScore` is returned but only
  `r.nextScore` is stored). The board shows 30, so a player who reads "current rarity 30"
  and clicks ▲ is actually betting that a hidden value in 30..69 goes up — the displayed
  number matches the server in 1 of 40 sessions. Every first round of a session is an
  uninformed coin flip presented as a decision; the same page state also survives a
  failed round, so the wrong 30 can be shown again. Real coins are lost on it.
- **Confidence**: confirmed
- **Fix direction**: seed the initial state from the server (or accept `currentScore` in
  the response and use it on the first round) so the displayed score is always the one
  the server compares against.

## games-a-2: Coinflip re-colours the whole flip history with the currently selected side
- **Severity**: medium
- **Side**: client
- **File**: `src/components/games/CoinflipGame.tsx:52`
- **Evidence**:
  ```tsx
  className={`grid size-10 place-items-center rounded-full border text-xs font-black ${
    flip === side            // :52 — `side` is the live dropdown state, not the played side
      ? "border-success bg-success/15 text-success"
      : "border-danger bg-danger/15 text-danger"
  }`}
  ```
  The server returns the side it actually resolved against — `result: { side, flips, survived, ladder7 }`
  (`src/lib/gamification/games.ts:290`) — but line 14 stores only `result.result.flips`.
- **Why it is a bug**: the side chips (`:24`) and the target slider (`:34-41`) are not
  disabled while a round is in flight or after it. Clicking "tails" after a round
  re-renders the *previous* flips against `side = "tails"`, flipping every colour, so a
  lost ladder renders as a winning-looking row and vice versa. The client also never
  renders `survived` or `payout`, and the balance is not shown (see games-a-4), so the
  green/red dots are the player's only outcome signal — and they can be inverted by a
  single click.
- **Confidence**: confirmed
- **Fix direction**: store `side`/`survived` from the response with the flips (or key the
  colouring off `result.result.side`), and disable the side/target controls while `busy`.

## games-a-3: rps/blackjack `streak5` is evaluated one round late and without the current round's result
- **Severity**: medium
- **Side**: server
- **File**: `src/lib/gamification/games.ts:101` (vs the insert at `:105`), `:164-180`
- **Evidence**:
  ```ts
  const streakFlags = await currentStreakFlags(supabase, userId, gameId);   // :101 — before the round is written
  const result = { ...outcome.result, ...streakFlags };
  const { error: roundError } = await supabase.from("game_rounds").insert({ ... result, won: outcome.payout > bet });  // :105-112
  ```
  ```ts
  const rounds = (data ?? []) as Array<{ won: boolean }>;   // the 5 PREVIOUS rounds
  if (gameId === "rps" || gameId === "blackjack") return streak >= 4 ? { streak5: true } : {};
  ```
  `hasFlag` reads exactly this payload: `flags: ((r.result ?? {}) as ...)` (`achievements.ts:358`, used at `:186`/`:158`).
- **Why it is a bug**: the flag describes rounds N-5..N-1 and is attached to round N's own
  row, whose outcome is unknown at that moment. (a) False positive: four wins followed by a
  **loss** on the fifth round stamps `streak5: true` onto a `won: false` row, unlocking
  "Mind Reader"/"Card Shark" with only four consecutive wins and a loss as the newest round.
  (b) False negative: a genuine five-in-a-row stamps nothing on the fifth round, so a player
  who wins five and stops never gets the achievement — it only lands if they play a sixth.
- **Confidence**: confirmed
- **Fix direction**: compute the streak after the insert (include the just-written round and
  require `outcome.payout > bet`) and patch the flag into that row, or evaluate the streak
  from `game_rounds` inside `evaluateAchievements` instead of a pre-insert payload flag.

## games-a-4: the coin balance is fetched, maintained and then thrown away — nothing on a game page shows it
- **Severity**: medium
- **Side**: client
- **File**: `src/components/games/useGame.tsx:20,26-34,57,69`; `BetBar` at `:115-119`; every caller, e.g. `RpsGame.tsx:23`, `CoinflipGame.tsx:19`, `HiloGame.tsx:28`, `RouletteGame.tsx:19`, `BlackjackGame.tsx:24`
- **Evidence**:
  ```tsx
  const [balance, setBalance] = useState<number | null>(null);   // useGame.tsx:20
  const res = await fetch("/api/progress"); ... setBalance(data.coins);   // :28-30
  setBalance(data.balance);                                       // :57
  return { balance, bet, setBet, busy, error, last, play, refresh, t };   // :69
  ```
  ```tsx
  {balance !== null && ( <span ...><Coin size={15} /> {balance.toLocaleString("en")}</span> )}   // :115-119
  ```
  ```tsx
  <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={null} />   // RpsGame.tsx:23 (identical in all 13 games)
  const { bet, setBet, busy, error, play, t } = useGame("rps");        // RpsGame.tsx:13 — balance/last/refresh never destructured
  ```
- **Why it is a bug**: `balance={null}` is hardcoded in all 13 game components and no caller
  reads `balance`, `last` or `refresh`, so the balance UI is dead code and the only consumer
  of `/api/progress` in the whole repo (`grep -rn "api/progress" src/` → this line only)
  is a wasted serverless call per page view. Concretely: a player with 40 coins can still
  pick the 5 000 chip (the shortcut chips are bounded by the game's `maxBet`, never by the
  balance), cannot see the result of their last round (`payout` from the response is never
  rendered either), and only learns their balance from the raw English
  "Not enough coins." error. The header/hub (`games/page.tsx:74`) shows coins only on the
  hub, which is a different page — the game detail page has no balance anywhere.
- **Confidence**: confirmed
- **Fix direction**: pass `balance={balance}` from the games, clamp the chip/`max` to
  `min(maxBet, balance ?? maxBet)`, and render `last.payout` after a round.

## games-a-5: `award()`'s whole-row upsert reverts the atomic counter increments of any overlapping write
- **Severity**: medium
- **Side**: server
- **File**: `src/lib/gamification/xp.ts:150,192-215` (vs `supabase/migrations/0007_atomic_counters_gates.sql:21-37`)
- **Evidence**:
  ```ts
  const current = await getProgress(userId);            // xp.ts:150 — snapshot taken BEFORE two RPC round-trips
  const consumed = await supabase.rpc("consume_game_xp", ...);   // :159
  const applied  = await supabase.rpc("apply_xp_coins", ...);    // :173
  const { xp, coins, game_xp_today, game_xp_day, ...currentWithoutBalance } = current;   // :192-198 — only these are stripped
  const { error } = await supabase.from("user_progress").upsert({ ...currentWithoutBalance, ...patch }, ...);  // :209-214
  ```
  `bump_counters` is called by this very flow (`games.ts:118-126`) and by achievements
  (`achievements.ts:277-280`), which runs fire-and-forget right after every round
  (`games.ts:143`).
- **Why it is a bug**: `currentWithoutBalance` still contains `games_played`, `games_won`,
  `coins_won`, `coins_lost`, `wheel_spins`, `achievements_points`, … — the exact columns
  0007 moved to atomic deltas "written as read-modify-write and lost one increment whenever
  two writes overlapped". Every round re-writes them from a snapshot taken ~2 RPCs earlier,
  so any bump landing in that window is silently reverted. Reachable without any exotic
  race: the previous round's `evaluateAchievements` keeps running (it reads profiles,
  badges, rounds, then bumps `achievements_points`) while the next round — allowed after
  1 s by the rate limit — reads its snapshot; a wheel spin or daily claim overlapping a
  round does the same.
- **Confidence**: likely (proven from the code; needs two overlapping writers to observe)
- **Fix direction**: strip every counter column from the upsert the way xp/coins already are
  (or drop the upsert to an explicit `update({ level, updated_at })`).

## games-a-6: `k_hilo_10` ("Rarity Sense") is unattainable — hilo hardcodes `streak10: false`
- **Severity**: medium
- **Side**: server
- **File**: `src/lib/gamification/games.ts:312` (achievement at `src/lib/gamification/achievements.ts:163`)
- **Evidence**:
  ```ts
  result: { currentScore, nextScore, guess, actual, won, streak10: false },   // games.ts:312
  ```
  ```ts
  CREATIVE("k_hilo_10", "Rarity Sense", "Predict 10 higher/lower rounds in a row.", (s) => hasFlag(s, "hilo", "streak10")),   // achievements.ts:163
  ```
- **Why it is a bug**: `hasFlag` only ever sees `game_rounds.result` (`achievements.ts:88-90`,
  `:358`), and hilo never emits any flag except `streak10`, which is the constant `false`.
  The achievement is listed in the catalog with 500 XP / 250 coins / 25 points and can never
  unlock. (`currentStreakFlags` at `games.ts:177` only handles rps/blackjack, so nothing
  else fills the gap.) No amount of correct play earns it.
- **Confidence**: confirmed
- **Fix direction**: compute the hilo win streak after the insert and stamp `streak10: true`
  at >= 10, or remove the achievement from the catalog.

## games-a-7: Hilo's "equal" round is an automatic loss with no rule and no UI affordance
- **Severity**: low
- **Side**: server
- **File**: `src/lib/gamification/games.ts:306-311`, displayed at `src/components/games/HiloGame.tsx:36-38`
- **Evidence**:
  ```ts
  const nextScore = 5 + Math.floor(Math.random() * 91);                                  // :306 — 91 equiprobable values
  const actual = nextScore === currentScore ? "equal" : nextScore > currentScore ? "higher" : "lower";  // :308
  const won = actual === guess;                                                          // :309 — "equal" never equals a guess
  ...
  payout: won ? Math.floor(bet * 1.95) : 0,                                              // :311
  ```
  ```tsx
  {state.won ? t("youWin") : t("youLose")} ({state.actual})   // HiloGame.tsx:37
  ```
- **Why it is a bug**: when `nextScore === currentScore` (≈1.1 % of rounds, ~1 in 91) there is
  no correct answer — both ▲ and ▼ forfeit the whole bet, and the player is told only
  "You lose (equal)". The game offers no push and never states the rule, so it reads as an
  unexplained loss of coins.
- **Confidence**: likely (behaviour confirmed; whether it is intentional is not documented)
- **Fix direction**: refund (or push) on `actual === "equal"`, or document the tie rule in
  `hiloHint`.

## games-a-8: server error strings are rendered raw, untranslated, in all 11 locales
- **Severity**: low
- **Side**: client
- **File**: `src/components/games/useGame.tsx:53,60`
- **Evidence**:
  ```ts
  if (!data.ok) { setError(data.error ?? "Round failed"); return null; }   // :53
  ...
  } catch { setError("Network error"); return null; }                      // :60
  ```
  Server-side literals: `"Bet must be between … coins."` (`games.ts:75`),
  `"Slow down — one round per second."` (`:92`), `"Not enough coins."` (`:96`),
  `"Unknown game."` (`:72`).
- **Why it is a bug**: `GameError` prints these strings verbatim
  (`useGame.tsx:127-129`), so the games page shows English sentences on the de/fr/… builds,
  violating the AGENTS.md rule that all UI strings go through `messages/<locale>.json`.
  The sibling `WheelOfFortune.tsx:47` shows the intended pattern (server code → `t(key)`).
- **Confidence**: confirmed
- **Fix direction**: return a stable error code from `playGame` (`not_enough_coins`, …) and
  map it to a translated message in `useGame`.

## games-a-9: fractional bets are accepted by the client and silently floored by the server
- **Severity**: low
- **Side**: client
- **File**: `src/components/games/useGame.tsx:110-112` (vs `src/lib/gamification/games.ts:73`)
- **Evidence**:
  ```tsx
  onChange={(event) => setBet(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
  ```
  ```ts
  bet = Math.floor(bet);   // games.ts:73 — the server floors what it receives
  ```
- **Why it is a bug**: `<input type="number">` accepts `10.5`; the clamp keeps it (10.5 is
  inside [10, 5000]) and it is POSTed as-is. The server floors it to 10, so the payout
  previews disagree with the round: coinflip at target 1 shows `floor(10.5 * 2 * 0.97) = 20`
  while the server pays `floor(10 * 2 * 0.97) = 19`. The `chip` active state (`bet === step`)
  also stops highlighting for such values.
- **Confidence**: confirmed
- **Fix direction**: `Math.floor(...)` (and `Number.isFinite` guard) in the `onChange`
  clamp so the value sent is the value previewed.

---

## Checked and found clean in these six files
- **Timers**: the only timer (`useGame.tsx:36-39`) is a 0 ms deferred `refresh()` and its
  cleanup clears it — no leaked interval/timeout in any of the five games.
- **`Date.now()` / `Math.random()` during render**: none; all randomness is server-side
  (`games.ts`), and no component reads a clock while rendering.
- **Double submit**: every round trigger is `disabled={busy}` and `setBusy(true)` is
  synchronous before the first `await` (`useGame.tsx:43`), so a discrete click/second click
  cannot start two rounds; the server's 1 round/second flood check (`games.ts:80-93`) is the
  backstop.
- **`busy` stuck true**: `finally { setBusy(false) }` (`useGame.tsx:62-64`) runs on error,
  non-JSON and network rejection alike; no path leaves it stuck (a hung fetch with no timeout
  is possible but not specific to these files).
- **Payout rounding / win-flag consistency**: rps (`bet*2`/tie), coinflip, hilo, roulette and
  blackjack all return integer payouts, and the client's win/tie/push branches agree with
  `won = payout > bet` for every outcome the server can produce — except the "equal" case in
  games-a-7.
- **Bet bounds**: client min/max per game (`10`/`5000` here) match `GAMES` in `games.ts:19-33`;
  NaN/negative/excess input is clamped by the chip+clamp path and re-validated server-side
  (`games.ts:74`). Insufficient balance is rejected server-side (`games.ts:96`) — the *lack of
  any client-side indication* is reported as games-a-4.
- **Keyboard playability**: all five games use native `<button>`/`<input type="range">`,
  nothing is hover/pointer-only, and there is no `<form>` to mis-trigger on Enter.
- **i18n keys**: every dynamic key reachable from these components (`t(choice)` →
  rock/paper/scissors, `t(last.bot)`, `t(last.player)`, heads/tails/red/green/black,
  bet/payout/you/bot/tie/youWin/youLose/ladderTarget/flip/currentRarity/higher/lower/
  hiloHint/stopAt/deal/push) exists in `messages/en.json` **and** `messages/de.json`
  (83 `games.*` keys each) — no `MISSING_MESSAGE` from these pages.
