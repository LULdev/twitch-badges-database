# Games, stealing and the inventory

Audited (read in full unless noted): `src/lib/gamification/games.ts`,
`src/components/games/*.tsx` (all 14 files: `useGame.tsx`, `BetBar`,
`RoundOutcome`, Rps, Coinflip, Hilo, Roulette, Blackjack, Vault, Scratch, Tower,
Slots, Shoot, Memory, Quiz, Catcher), `src/app/api/games/play/route.ts`,
`src/app/api/games/symbols/route.ts`, `src/app/api/steal/route.ts`,
`src/lib/gamification/daily.ts` (`attemptSteal`), `src/components/StealPanel.tsx`,
`src/lib/inventory.ts`, `src/app/api/inventory/sync/route.ts`,
`src/lib/settings.ts` (`getGames`/`gameRules`/`getEconomy`),
`src/app/[locale]/games/page.tsx`, `src/app/[locale]/games/[game]/page.tsx`,
`src/app/[locale]/profile/[username]/page.tsx` (the StealPanel call site),
`src/components/inventory/SyncButton.tsx`, `src/lib/twitch/perfil.ts`,
`src/lib/gamification/achievements.ts` (the game-flag consumers + `buildStats`),
`scripts/verify-game-economy.ts`, and the SQL of migrations
`0001`/`0003`/`0015`.

Method: file reads plus (a) `npx eslint` over the scoped paths — 0 errors,
0 warnings; (b) `node -e` Monte-Carlo simulations of the pure resolvers
(blackjack for every `stopAt` 12–20, scratch 2M rounds, the scratch jackpot
multiplier distribution); (c) read-only `SELECT`s against the live database via
`SUPABASE_DB_URL` + `postgres` in `node -e` (privilege checks, `pg_policies`,
`pg_proc` signatures, table columns, catalog/inventory counts). I could not run
an authenticated end-to-end HTTP test (no session), so F1's chain is proven from
the code plus the live grants rather than executed; every other finding is
proven by reading or running.

Prior art checked so as not to re-report: `bugreports/agent-02`, `agent-03`,
`agent-06`, `agent-15`, `agent-16`, `fix-c-gamification.md`, `BUGS.md`,
`acp-bugs/VERIFIED.md`, and the sibling full-audit reports already on disk
(`03-auth-profile.md` B3/B4/B5, `04-gamification-core.md`, `07-db-layer.md` B5).
`04-gamification-core.md` B5 already covers the hardcoded `> 6` in the steal race
recheck (`daily.ts:181`) — not repeated here.

---

## F1 — The badge-unlock reward is not idempotent, and `user_inventory` is user-deletable: a member can mint XP and coins forever in two requests

- **Severity**: high (unbounded, repeatable, any signed-in member; the economy's
  two currencies are minted at will)
- **Confidence**: high (code + live grants verified; the HTTP chain is not
  executed because it needs an authenticated session)
- **Where**: `src/lib/inventory.ts:88-133` (the reward), reached from
  `src/app/api/inventory/sync/route.ts:31`; enabler
  `supabase/migrations/0001_init.sql:372-375` + `:400` (the sibling
  `07-db-layer.md` B5 reports the INSERT half of the same grant pair)
- **Code**:
  ```ts
  // inventory.ts:88-89 — "newly owned" is recomputed from the CURRENT row set only
  const toAdd = [...ownedIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !ownedIds.has(id));
  ...
  // inventory.ts:112-132 — every re-added row is rewarded again, with no record
  // that this badge's reward was ever paid
  if (toAdd.length > 0) {
    const addedBadges = catalogRows.filter((row) => toAdd.includes(row.id));
    for (const badge of addedBadges) {
      await logActivity({ userId, kind: "badge_claim", title: `unlocked badge: ${badge.title}`,
        body: "New Twitch badge claimed — +1,000 XP, +500 coins.", xpAmount: 1000, coinsAmount: 500, ... });
    }
    await award(userId, { xp: addedBadges.length * 1000, coins: addedBadges.length * 500,
      source: "badge_claims", skipAchievements: false });
  }
  ```
  ```sql
  -- 0001_init.sql:372-375 + 400 (live: has_table_privilege('authenticated',
  -- 'public.user_inventory','DELETE') = true, and the policy is self-scoped)
  create policy "inventory_self_delete" on public.user_inventory
    for delete using (user_id = auth.uid());
  grant delete on public.user_inventory to authenticated;
  ```
- **Why it is wrong**: the reward is keyed on "this badge is in the inventory now
  but was not a second ago", not on "this badge has never been rewarded", and
  nothing else in the schema records a paid claim. The member controls the "was
  not a second ago" half through the public REST API: `DELETE
  /rest/v1/user_inventory?user_id=eq.<me>&badge_id=eq.<a badge I own>` is granted
  and policy-permitted (verified live), then `POST /api/inventory/sync`
  re-inserts the row from the live perfil list and pays `+1,000 XP, +500 coins`
  again plus a fresh public feed entry. Repeat per owned badge, indefinitely;
  the sync route has no server-side throttle (only `SyncButton.tsx:26`'s 4-second
  client timer) and each cycle is two HTTP requests. A member owning one badge
  mints 1,000 XP + 500 coins per cycle and spams `/feed`; a full collector mints
  476,000 XP + 238,000 coins per cycle. XP is uncapped (`award`'s only cap,
  `consume_game_xp`, applies to `countsAsGameXp` rounds, and this call omits it).
- **How to reproduce**: as the authenticated member, `DELETE` one owned badge row
  via PostgREST, then `POST /api/inventory/sync`, and observe
  `user_progress.coins += 500`, `xp += 1000` and a new `activity_events` row; a
  second identical cycle does it again.
- **Suspected cause**: the reward is derived from set difference instead of a
  durable "claim paid" marker, while the inventory table is (unnecessarily)
  client-writable.
- **Direction (one sentence)**: pay on a first-ever claim only (a `badge_claims`
  ledger / `user_inventory.claimed_at`), and revoke the client INSERT/DELETE on
  `user_inventory` — the app's only writer is the service role.

## F2 — Five achievements unlock from a client-reported score, so a crafted 10-coin round buys 500 XP + 250 coins

- **Severity**: medium (reward/economy integrity; ~2,500 XP + 1,250 coins for
  roughly 50 coins of stake)
- **Confidence**: high (verified by reading the resolvers, the insert and the
  flag consumers)
- **Where**: `src/lib/gamification/games.ts:317-330` (shoot), `:333-348` (memory),
  `:351-366` (quiz), `:496-511` (catcher) → stored at `:123` and `:125-136` →
  `src/lib/gamification/achievements.ts:96` (`hasFlag`), `:165,166,167,172,197`
- **Code**:
  ```ts
  // games.ts:317-330 — the score is client-supplied; the flag is emitted from it
  const hits = clampInt(input.hits, 0, 300);
  const shots = clampInt(input.shots, hits, 600);
  const accuracy = shots > 0 ? hits / shots : 0;
  ...  sharp: accuracy >= 0.9,
  ```
  ```ts
  // games.ts:333-348 / :351-366 / :496-511 — same shape
  perfect: misses === 0,   fast: timeMs <= 30000,
  streak10: correct === total && total >= 10,
  hundred: caught >= 100,
  ```
  ```ts
  // games.ts:123 — stored on the round row regardless of the round's outcome
  const result = { ...outcome.result, ...streakFlags };
  // achievements.ts:96 / :501
  function hasFlag(s, game, flag) { return s.recentResults.some((r) => r.game === game && !!r.flags?.[flag]); }
  flags: ((r.result ?? {}) as Record<string, number | boolean>),
  ```
- **Why it is wrong**: the earlier fix capped the *payout* of a forged score at
  0.90 expected value, but the same forged score also writes achievement flags
  into `game_rounds.result`, and `evaluateAchievements` (`games.ts:205`) runs
  after every round and reads them back as truth. `won` is not consulted, so a
  **losing** round still carries the flag: `POST /api/games/play
  {"game":"shoot","bet":10,"input":{"hits":300,"shots":300}}` costs 10 coins,
  usually returns 0, and unlocks "Sharpshooter" (500 XP / 250 coins / 25 points).
  The same one-shot payload unlocks `k_perfect_memory` (`{"timeMs":5000,
  "misses":0}`), `k_speedrunner` (`{"timeMs":5000}`), `k_quiz_10`
  (`{"total":10,"correct":10}`) and `k_catcher_100` (`{"caught":100,"missed":0}`)
  — five CREATIVE achievements, ~2,500 XP + 1,250 coins + 125 points, plus five
  public feed entries.
- **How to reproduce**: send each payload once with `bet: 10` (a fresh account,
  no play needed) and watch the five achievements unlock while the balance barely
  moves.
- **Suspected cause**: the flags were kept client-derived when payouts were moved
  server-side; only the payout was hardened, not the flag that gates the reward.
- **Direction**: derive `sharp`/`perfect`/`fast`/`streak10`/`hundred` server-side
  from server-issued state (or gate the corresponding achievements on
  `won === true`, which at least stops the free flag on a loss).

## F3 — `k_vault_master` ("Crack the vault perfectly three times") can never unlock: the resolver emits `perfect`, the achievement reads `perfect3`

- **Severity**: medium (a permanently locked achievement with XP/coin/point value,
  listed in the UI as obtainable)
- **Confidence**: high (verified by reading + mechanical cross-check of every
  `hasFlag` consumer against every emitted result field)
- **Where**: `src/lib/gamification/achievements.ts:170` vs
  `src/lib/gamification/games.ts:457`
- **Code**:
  ```ts
  // achievements.ts:170
  CREATIVE("k_vault_master", "Vault Cracker", "Crack the vault perfectly three times.",
    (s) => hasFlag(s, "vault", "perfect3")),
  ```
  ```ts
  // games.ts:448-458 — vault emits `perfect`, never `perfect3`
  const matches = clampInt(input.matches, 0, 3);
  const chance = [0.05, 0.15, 0.29, 0.45][matches];
  const won = Math.random() < chance;
  return { payout: won ? bet * 2 : 0,
           result: { matches, chance, won, perfect: matches === 3 } };
  ```
- **Why it is wrong**: `grep -rn "perfect3" src/ scripts/ supabase/` returns only
  the achievement definition — no code writes it. `hasFlag` reads
  `game_rounds.result` (`achievements.ts:501`), and vault's flag is `perfect`, so
  `flags["perfect3"]` is always `undefined` and the predicate is always false. The
  achievement is displayed in the catalogue (500 XP / 250 coins / 25 points) and
  is unobtainable at any skill level — the same class as the two unreachable
  achievements the sibling `04-gamification-core.md` reports (B1 `k_marathon_day`,
  B2 `k_retro_2017`), found here because the mismatch spans `games.ts` and
  `achievements.ts`.
- **How to reproduce**: by inspection; a mechanical pass over all 14 `hasFlag`
  calls (`blackjack/streak5`, `catcher/hundred`, `coinflip/ladder7`,
  `hilo/streak10`, `memory/fast`, `memory/perfect`, `quiz/streak10`,
  `roulette/green`, `rps/streak5`, `scratch/jackpot`, `shoot/sharp`,
  `slots/scatter`, `tower/top`, `vault/perfect3`) shows every other flag matches
  an emitted field; `perfect3` is the only orphan.
- **Suspected cause**: the achievement was written against an earlier result shape
  and never reconciled when vault moved to chance-based payouts.

## F4 — `k_slots_scatter` unlocks on a single scatter symbol; the correct boolean it should read is computed and thrown away

- **Severity**: low-medium (achievement unlocked by a state the description
  excludes)
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/gamification/achievements.ts:195` + `src/lib/gamification/games.ts:304-313`
- **Code**:
  ```ts
  // games.ts:304-313
  let scatter = 0;
  for (let col = 0; col < 5; col += 1) {
    if (reels.some((row) => row[col] === "scatter")) scatter += 1;   // a COUNT (0..5)
  }
  if (scatter >= 3) payout += bet * (scatter === 3 ? 2 : scatter === 4 ? 5 : 20);
  const jackpot = payout >= 5000;
  return { payout: Math.min(payout, bet * 25),
           result: { reels, lineWins, scatter, jackpot, scatterHit: scatter >= 3 } };
  ```
  ```ts
  // achievements.ts:195 — truthiness, not `>= 3`
  CREATIVE("k_slots_scatter", "Scatter! ", "Land 3+ scatter badges in Badges of Ra.",
    (s) => hasFlag(s, "slots", "scatter")),
  // achievements.ts:96
  return s.recentResults.some((r) => r.game === game && !!r.flags?.[flag]);
  ```
- **Why it is wrong**: `scatter` is the number of columns containing a scatter
  badge, and `hasFlag` tests truthiness, so `scatter: 1` (one scattered badge —
  no bonus was paid, the payout branch needs `>= 3`) unlocks "Land 3+ scatter
  badges". The server already computes the correct predicate and stores it as
  `scatterHit` (unread by anything: `grep -rn "scatterHit" src/` → the literal in
  `games.ts` only), so the flag and the description disagree by one indirection.
- **How to reproduce**: by inspection; or spin slots until a single scatter
  column appears (common) and watch the achievement unlock.
- **Suspected cause**: a count was stored where the achievement wanted the boolean
  beside it.

## F5 — `k_scratch_jackpot` ("Win a 20× payout") fires on a 1.4× win, and 20× is unreachable; a three-of-a-kind is a net loss

- **Severity**: low-medium (an achievement whose stated condition cannot occur,
  plus a payout table that makes the nominal win condition lose money)
- **Confidence**: high (verified by reading; the multiplier distribution was
  measured over 500,000 simulated rounds)
- **Where**: `src/lib/gamification/games.ts:469-477` + `src/lib/gamification/achievements.ts:171`
- **Code**:
  ```ts
  // games.ts:469-477
  for (const [symbol, count] of counts) {
    if (count >= 3) {
      const base = count === 3 ? 0.7 : count === 4 ? 2 : 5;
      mult = Math.max(mult, symbol === "jackpot" ? Math.min(20, base * 2) : base);
    }
  }
  const jackpot = (counts.get("jackpot") ?? 0) >= 3;
  return { payout: Math.floor(bet * mult), result: { cells, mult, jackpot } };
  ```
  ```ts
  // achievements.ts:171
  CREATIVE("k_scratch_jackpot", "Golden Scratch", "Win a 20× payout on a scratch card.",
    (s) => hasFlag(s, "scratch", "jackpot")),
  ```
- **Why it is wrong**: two defects from one table. (a) The jackpot branch is
  `Math.min(20, base * 2)` with `base ∈ {0.7, 2, 5}`, so the jackpot symbol's
  multiplier is at most **10×** and `20` is dead — but `jackpot: true` is set for
  any 3+ jackpot symbols, so the achievement unlocks for a **1.4×** payout.
  Measured over 500,000 rounds, the `jackpot` flag fires on ~1.4% of rounds and
  the multiplier distribution among those is `1.4× : 6,265, 4× : 550, 10× : 41` —
  i.e. 91% of "Golden Scratch — Win a 20× payout" unlocks are 1.4× wins, and a 20×
  win never happens. (b) For an ordinary symbol a three-of-a-kind pays
  `floor(bet * 0.7)` — *below the stake* — while the round is recorded as
  `won: payout > bet` = false; a player who scratches three matching badges sees
  the nominal jackpot pattern, loses 30% of the bet, and the client
  (`ScratchGame.tsx`) renders neither the verdict nor the payout, so only the
  BetBar balance reveals it.
- **How to reproduce**: `node -e` simulation of `scratchSymbol()`×9 (2M rounds:
  EV 0.983 — so the table is not exploitable) confirming the multiplier set
  `{0, 0.7, 1.4, 2, 4, 5, 10}`; there is no path to 20.
- **Suspected cause**: the EV re-tuning (0.7/2/5 base) was applied to the jackpot
  branch through the same `min(20, base*2)` cap without re-reading the two
  consumers (the `jackpot` flag and the achievement text).

## F6 — The arcade's three on/off switches disagree, so a "switched off" game stays playable from the URL and a feature-disabled arcade looks fully live

- **Severity**: medium (the operator's off switch does not enforce anything on the
  path that matters; the mirror case shows a broken page)
- **Confidence**: high (verified by reading every consumer)
- **Where**: `src/app/[locale]/games/page.tsx:58-61`,
  `src/app/[locale]/games/[game]/page.tsx:44-45,81-95`,
  `src/app/api/games/play/route.ts:12-14,27`,
  `src/lib/settings.ts:159-179,211-217`, `src/lib/gamification/games.ts:86-88`
- **Code**:
  ```tsx
  // games/page.tsx:58-61 — the hub honours BOTH switches via settings.enabled…
  const settings = await getGames(GAMES);
  const visible = settings.enabled
    ? GAMES.filter((game) => settings.games[game.id]?.enabled !== false)
    : [];
  ```
  ```ts
  // api/games/play/route.ts:12-14 — …but the API only reads the feature flag,
  const features = await getFeatures();
  if (!features.games) return Response.json({ error: "feature disabled" }, { status: 403 });
  // games.ts:86-88 — and the engine only reads the per-game flag
  const rules = await gameRules(meta.id, { minBet: meta.minBet, maxBet: meta.maxBet });
  if (!rules.enabled) return fail("This game is currently switched off.");
  ```
  ```tsx
  // games/[game]/page.tsx:44-45,81-95 — neither switch is consulted at all
  const meta = GAMES.find((g) => g.id === game);
  if (!meta) notFound();
  ...  {game === "rps" && <RpsGame />}
  ```
- **Why it is wrong**: three keys decide whether a game may be played —
  `games.enabled` (master, `SettingsPanel.tsx:177`), `games.games[id].enabled`
  (per game), and `features.games` — and no two consumers agree:
  (a) master switch off → the hub renders zero tiles, but `/en/games/rps`
  (`[game]/page.tsx`, no check) still renders the full playable board and
  `POST /api/games/play` still settles rounds, because neither `playGame` nor the
  route reads `getGames().enabled`. The operator's kill switch is decorative.
  (b) `features.games` off → the route answers 403 "feature disabled" for every
  round, while the hub (`games/page.tsx` never calls `getFeatures`) still lists
  all thirteen tiles and the detail page still renders a playable-looking game:
  every round the member attempts fails.
  (c) one game disabled → the tile is hidden and the engine refuses, but its URL
  still renders the board, so each round shows the raw English
  "This game is currently switched off." (`games.ts:87`).
  The same area is the still-open admin-panel item; the sharper point here is
  (a): the *enforcement* is missing exactly where it matters.
- **How to reproduce**: turn the arcade master switch off in the panel, then open
  `/en/games/rps` and play a round (200 OK, coins move). Then set
  `features.games = false` and open `/en/games` (tiles present, every round 403).
- **Suspected cause**: the master/feature flags were added at different times and
  wired into the page that reads them rather than into the engine.

## F7 — The steal panel advertises the hardcoded fallback price while the engine charges the operator's configured one

- **Severity**: low (the price the victim's visitor is told is not the price the
  server applies)
- **Confidence**: high (verified by reading both sides)
- **Where**: `src/app/[locale]/profile/[username]/page.tsx:682-689` +
  `src/components/StealPanel.tsx:66-68` vs `src/lib/gamification/daily.ts:108-112`
- **Code**:
  ```tsx
  // profile page — the CLIENT fallback is the literal 100/250
  <StealPanel victim={profile.username}
    price={profile.steal_price ?? 100} maxAmount={profile.steal_max ?? 250}
    enabled={profile.steal_enabled !== false} />
  ```
  ```ts
  // daily.ts:108-112 — the SERVER fallback is the settings document, clamped
  const settings: StealSettings = {
    enabled: victimProfile.steal_enabled ?? STEAL_DEFAULTS.enabled,
    price: Math.max(0, victimProfile.steal_price ?? economy.stealPrice),
    maxAmount: Math.max(10, victimProfile.steal_max ?? economy.stealMax),
  };
  ```
- **Why it is wrong**: `economy.stealPrice`/`stealMax` are admin-editable
  (`SettingsPanel.tsx:40-41`, defaults 100/250). Once an operator changes them, a
  member who never set their own values is shown "an attempt costs 100, up to 250"
  (`StealPanel`'s `hint`) while the server charges and settles the new figures —
  the panel's own claim about the transaction is false. The missing clamps are
  cosmetic by comparison (`steal_price` of `-5` would display "-5" for a server
  cost of 0; `steal_max` of `0` displays 0 for a server cap of 10), so the real
  defect is the two different fallbacks for one number.
- **How to reproduce**: set `economy.stealPrice = 500` in the panel, view a
  member profile whose `steal_price` is NULL → the hint says 100, the attempt
  costs 500.
- **Suspected cause**: the client copy predates the settings document.

## F8 — `useGame.play()` has no in-flight guard, and Vault's "again" button re-arms during the settling round

- **Severity**: low (a second round can be charged while the first is still open;
  no profit, but a double-spend of the player's own coins and two responses
  racing into `last`/`balance`)
- **Confidence**: medium (mechanism confirmed in the code; the window is one round
  trip — the three dial stops are ≥ 500 ms apart by the guard, so it needs a slow
  request)
- **Where**: `src/components/games/useGame.tsx:41-67` +
  `src/components/games/VaultGame.tsx:112-114`
- **Code**:
  ```tsx
  // VaultGame.tsx:112-114 — `start` has no busy check and the button is not disabled
  {phase === "done" && (
    <button type="button" onClick={start} className="btn btn-secondary w-full">{t("again")}</button>
  )}
  ```
  ```ts
  // useGame.tsx:41-45 — play() only sets a flag; it never refuses a re-entry
  const play = useCallback(async (input = {}) => {
    setBusy(true);
    setError(null);
    ...
  ```
- **Why it is wrong**: `phase` flips to `"done"` and `void play({ matches })` is
  fired in the same commit, so "again" is live while the previous round's POST is
  still open; `start()` resets the dials and the player can stop all three again
  (each stop ≥ 250 ms apart by `lastStopAt`) before the first response lands, so a
  second `/api/games/play` is issued for the same bet. `busy` disables the BetBar
  chips but is never consulted by `start`, and the hook has no `if (busy) return`.
  Every other game either disables its start control with `busy` (Memory, Shoot,
  Catcher, Rps, Roulette, Blackjack, Coinflip, Scratch, Tower, Hilo) or guards the
  handler (`QuizGame.startRound`'s `if (busy) return`, `SlotsGame.spin`'s
  `if (spinning) return`) — Vault's `again` is the one unguarded path.
- **How to reproduce**: by inspection; at runtime, restart the three dials the
  instant the third stop is clicked and complete them within one request latency.
- **Suspected cause**: the round is settled from a state transition (`done`)
  rather than from the settled promise.

---

## Checked and found clean

- **Payout arithmetic / EV for all 13 games** — no game returns more than the
  stake on a cheating payload. `node -e` simulations: blackjack is worst at
  `stopAt 16` (0.914) and safe at every `stopAt` 12–20 (`12: 0.823, 13: 0.855,
  14: 0.884, 15: 0.901, 16: 0.914, 17: 0.914, 18: 0.877, 19: 0.767, 20: 0.582`);
  scratch = 0.983 over 2M rounds; tower `cashoutAt:1` = 0.903 and falls from
  there; vault `matches:3` = 0.90; the four skill games cap at
  `chance 0.45 × 2 = 0.90` and fall with the ratio; rps 1.9× on 1/3 = 0.633
  (tie refunded), coinflip `2^n × 0.97 / 2^n` = 0.97 at every target, roulette
  green `14/37` = 0.378 and red/black `36/37` = 0.973, hilo `1.95 × 45/91 +
  1/91` ≈ 0.976. The project's own `scripts/verify-game-economy.ts` agrees.
- **Bet handling** — `Math.floor` then `Number.isFinite` and a range check
  (`games.ts:88-91`), plus a route-level `Number.isFinite`/`> 0` guard
  (`play/route.ts:24-26`); `NaN`/`Infinity`/negative/out-of-range are refused,
  unknown `game` ids are refused before the switch (`games.ts:81-82`), and
  `input` of any shape degrades through `clampInt`. No `Number()` reaches a
  query or a write without a finite check in the scoped files.
- **Game flood limit** — the 1/s pre-check (`games.ts:96-108`) plus the
  post-insert two-row recheck that voids the racer's own row
  (`games.ts:146-171`); nothing has moved at the point of the void, so the worst
  case is a refused retry. The 900 ms slack covers app-clock/DB-clock skew.
- **Steal guards** — self-steal, disabled victim, LIKE escaping (`\\%`/`\\_`),
  non-existent victim (`maybeSingle`), `cost` affordability, zero/negative victim
  balance, the pair and hourly windows, the post-insert race void, and the
  zero-sum transfer via `apply_pair_deltas` (live signature
  `(p_a, p_a_delta, p_b, p_b_delta) → TABLE(a_coins, b_coins)` matches; both
  deltas are `greatest(0, …)` so neither balance can go negative). The hardcoded
  `> 6` in the race recheck is `04-gamification-core.md` B5 — not re-reported.
- **Integration contract** — every RPC the scoped code calls exists live with the
  expected argument names and return shape (`bump_counters(p_user_id, p_deltas)`,
  `add_coins(p_user_id, p_amount) → bigint`, `apply_pair_deltas`, `apply_xp_coins`,
  `claim_daily_gate`, `claim_wheel_gate`, `consume_game_xp`, `bump_view_count`),
  and `game_rounds`/`steal_attempts`/`user_inventory`/`user_sync_state`/
  `coin_rain_gate` carry every column the scoped selects/inserts use.
- **Inventory read sizing** — the live catalog is 476 badges and the paged read in
  `inventory.ts:34-54` breaks on a short page, so PostgREST's 1000-row cap cannot
  truncate it yet; `getInventory` and the achievements badge read are single-user
  reads under the same cap.
- **i18n of the scoped UI** — every literal `t("…")` key in the 14 game components
  and `StealPanel.tsx`, plus the dynamic sets
  (`rps/coinflip/roulette` choices, all 13 `<id>Title`/`<id>Desc`, `steal.disabled`,
  `notEnoughBadges`), resolves in all eleven `messages/*.json`; the `games` and
  `steal` namespaces are key-identical across all eleven locales (checked
  mechanically). The known residual — English error strings from
  `playGame`/`attemptSteal` rendered raw — is the already-reported item from
  `agent-06`/`agent-02` and is unchanged, so it is not repeated as a finding.
- **CSRF on the POST routes** — `play`/`steal`/`inventory/sync` read JSON bodies
  without a content-type or Origin check, but the session cookie comes from
  `@supabase/ssr`'s defaults (`server.ts` sets no overrides → `SameSite=Lax`), so a
  cross-site POST carries no session and the routes answer 401. Medium confidence
  (the default lives in the dependency, not in this repo).
- **Client timers / double-submit in the games** — every rAF/interval is cancelled
  on cleanup (`SlotsGame`, `ShootGame`, `CatcherGame`, `VaultGame`), Quiz's
  advance timer is cleared on unmount, and each start/trigger control is disabled
  by `busy` except Vault's "again" (F8).
- **`ScratchGame`'s symbol labels** (`Prime`, `Turbo`, `SUBtember`, `JACKPOT`) are
  brand names kept in English deliberately, matching the `de`-locale convention;
  the `✦`/`!` placeholders are glyphs, not emoji.
