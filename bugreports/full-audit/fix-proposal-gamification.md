# Fix proposal — gamification findings (VERIFIED items 11–23, 52, 53)

Design only. I have not modified any file or touched the database. Every snippet
below is the exact current text from disk and the exact replacement I would
paste, in the file's own style.

Scope: item 11 (three arcade switches), 12 (client-reported achievement flags),
13–17 (unreachable / mis-firing achievements), 18–20 (steal race limit, clock,
gate-before-award), 21 (feed flag), 23 (turbo weight), 52 (Vault in-flight
guard), 53 (StealPanel prices). Item 22 (analytics beacon double count) is
**not mine** and is skipped.

I agree with every verdict in this set; nothing here is refuted. Each fix ends
with its own changelog obligation — `npm run log:change` for code-only changes,
and migration 0034 carries its own row.

Order is by severity as I judge it: 12, 11, 20, 13, 14, 15, 16, 17, 18, 19, 21,
23, 52, 53.

---

## Item 12 — a losing round stores the client-reported skill flag

**Severity: highest in this set.** Five CREATIVE achievements (~2,500 XP +
1,250 coins + 125 points) unlock from a client-supplied score, and the flag is
written on *every* round, win or lose.

### File 1 of 2 — `src/lib/gamification/games.ts`

**Current** (`:316-331`, the `shoot` case):

```ts
    case "shoot": {
      const hits = clampInt(input.hits, 0, 300);
      const shots = clampInt(input.shots, hits, 600);
      const accuracy = shots > 0 ? hits / shots : 0;
      const outcome = skillPayout(bet, accuracy, 0.10);
      return {
        payout: outcome.payout,
        result: {
          hits, shots,
          accuracy: Number(accuracy.toFixed(3)),
          chance: Number(outcome.chance.toFixed(3)),
          won: outcome.won,
          sharp: accuracy >= 0.9,
        },
      };
    }
```

**Current** (`:333-349`, `memory`):

```ts
    case "memory": {
      const timeMs = clampInt(input.timeMs, 5000, 600000);
      const misses = clampInt(input.misses, 0, 100);
      const speed = 1 - Math.min(1, timeMs / 120000);
      const clean = 1 - Math.min(1, misses / 12);
      const outcome = skillPayout(bet, (speed * 0.5 + clean * 0.5), 0.10);
      return {
        payout: outcome.payout,
        result: {
          timeMs, misses,
          chance: Number(outcome.chance.toFixed(3)),
          won: outcome.won,
          perfect: misses === 0,
          fast: timeMs <= 30000,
        },
      };
    }
```

**Current** (`:351-367`, `quiz`):

```ts
    case "quiz": {
      const total = clampInt(input.total, 1, 20);
      const correct = clampInt(input.correct, 0, total);
      const ratio = correct / total;
      const outcome = skillPayout(bet, ratio, 0.05);
      return {
        payout: outcome.payout,
        result: {
          total, correct, ratio: Number(ratio.toFixed(2)),
          chance: Number(outcome.chance.toFixed(3)),
          won: outcome.won,
          // "10 correct answers in a row" is a single perfect long round here,
          // which is what the achievement description means.
          streak10: correct === total && total >= 10,
        },
      };
    }
```

**Current** (`:496-511`, `catcher`):

```ts
    case "catcher": {
      const caught = clampInt(input.caught, 0, 400);
      const missed = clampInt(input.missed, 0, 400);
      const net = caught - missed * 2;
      const ratio = Math.max(0, Math.min(1, net / 120));
      const outcome = skillPayout(bet, ratio, 0.08);
      return {
        payout: outcome.payout,
        result: {
          caught, missed,
          chance: Number(outcome.chance.toFixed(3)),
          won: outcome.won,
          hundred: caught >= 100,
        },
      };
    }
```

**Replacement** — the four flag expressions become win-gated, and each gets a
one-line comment tying it to the rule. `shoot`:

```ts
          sharp: outcome.won && accuracy >= 0.9,
```

`memory`:

```ts
          perfect: outcome.won && misses === 0,
          fast: outcome.won && timeMs <= 30000,
```

`quiz`:

```ts
          streak10: outcome.won && correct === total && total >= 10,
```

`catcher`:

```ts
          hundred: outcome.won && caught >= 100,
```

and extend `skillPayout`'s docblock (`:524-539`) with the rule, so the reason
lives where the flags are decided:

```ts
/**
 * Coin payout for the five browser-rendered skill games.
 *
 * Their score is produced in the client and cannot be verified server-side, so
 * paying out a multiplier of that score let anyone POST `hits: 300, shots: 300`
 * (or `matches: 3`) and collect a guaranteed +120 % … +200 % per round.
 *
 * Instead the score now only raises the WIN CHANCE, against a fixed 2x payout,
 * and the chance is capped so that even a forged perfect score stays below
 * break-even:
 *
 *   max chance 0.45 x 2x = 0.90 expected value per coin staked
 *
 * An honest perfect run therefore reaches the same ceiling — skill still pays,
 * exploiting pays no better. `ratio` is 0..1.
 *
 * The achievement flags these games emit (`sharp`, `perfect`, `fast`,
 * `streak10`, `hundred`) are gated on `outcome.won` for the same reason: the
 * flag must not be a second payout path. A forged score used to write the flag
 * on a LOSING round, so one 10-coin POST unlocked the achievement outright.
 */
```

### File 2 of 2 — `src/lib/gamification/achievements.ts`

The consumers (`:165-172`, `:197`) need **no change**: `hasFlag` already reads
whatever the round stored. I list them only to confirm the mapping stays intact
(`sharp`→`k_sharpshooter`, `perfect`→`k_perfect_memory`, `fast`→`k_speedrunner`,
`streak10`→`k_quiz_10`, `hundred`→`k_catcher_100`).

### Why this is correct

`won` is the only value in a skill round the server itself decides (the RNG roll
in `skillPayout`); the score is a client claim used solely to set the win
chance. The achievement flag therefore has to ride the same server-decided
value as the payout, or it is a free reward independent of the round. This is
exactly the report's Direction (`05-…` F2): "gate the corresponding achievements
on `won === true`, which at least stops the free flag on a loss."

### Design choice (stated, with a recommendation)

The defect named in the verdict is *"a losing round still stores the flag"*.
There are three honest ways to close it, and they trade off differently:

- **A (recommended): gate every flag on `outcome.won`.** One-word change per
  resolver, no economy impact, keeps all five achievements obtainable. Raises
  the forge cost from a single 10-coin POST to ~2.2 rounds on average (win
  chance 0.45) — i.e. ~22 coins for a 500-XP/250-coin achievement. **Residual:
  not eliminated.** A determined farmer still grinds wins.
- **B: retire the five achievements**, because their condition (a client-reported
  score) can never be observed server-side — the module's own precedent for
  `k_faq_scholar` ("a locked entry that can never unlock is a lie in the UI" is
  the mirror case: here the entry *can* unlock but the condition is unverifiable
  and farmable). Costs five of the 50 creative achievements, breaks the
  "exactly 50/50/25" catalog invariant and the FAQ/`levels` copy counts, and
  removes a legitimate skill goal.
- **C: make the four games server-authoritative** (server-issued round tokens /
  signed challenges). The real fix, and far larger than this round.

Recommend **A** now — it matches the verdict, is non-destructive, and makes the
code consistent with the payout rule already in place. If the ~22-coin residual
is judged too cheap for 500 XP, **B** is the honest next step and should be a
separate decision (it changes the catalog counts, which touch the FAQ copy in
all 11 locales).

### What it must not break

- The `won` field is unchanged and still written to `result` for every game, so
  `k_quiz_10` etc. still read a truthy flag on a winning round.
- Payouts, EV, the daily game-XP cap and the client `RoundOutcome` are untouched.
- `s_owl_gambler` (`r.won && r.hour === 3`) and the streak flags from
  `currentStreakFlags` (RPS/blackjack/hilo) are a separate, already
  server-derived path and are not touched.

### Risk if wrong

If `skillPayout`'s `won` were somehow not the same value the `game_rounds.won`
column gets, the flag could disagree with the verdict. It cannot: both read
`outcome.payout > bet` / `outcome.won` from the same object in the same call. The
only behavioural change is that unlucky honest runs no longer bank the flag —
which is the intended semantics of "win a 10× payout"-style achievements.

### Verify afterwards

- `npm run lint && npm run typecheck` clean.
- As a fresh account, POST `/api/games/play` with a forged payload, e.g.
  `{"game":"shoot","bet":10,"input":{"hits":300,"shots":300}}`. Repeat until a
  response has `"won":false`; check the round row:
  `select result->>'sharp' from game_rounds order by created_at desc limit 1;`
  → must be `false` on a loss. `select achievement_id from user_achievements
  where user_id='<me>' and achievement_id='k_sharpshooter';` must stay empty
  until a **winning** forged round. Then a winning round: `sharp` is `true` and
  the achievement appears.

---

## Item 11 — the three arcade switches disagree

**Severity: medium.** The operator's master kill switch is decorative on the
path that matters (`POST /api/games/play` still settles rounds; the game URL
still renders a playable board), and `features.games=false` leaves a fully
listed arcade whose every round 403s.

There are three enforcement points to bring into agreement: the engine (single
source of truth), the hub page, and the detail page. The API route already
honours `features.games` and is left as is (defence in depth in the engine is
added anyway).

### File 1 of 3 — `src/lib/gamification/games.ts` (the engine)

**Current** (`:1-4`):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { award, bumpCoins, getProgress } from "./xp";
import { evaluateAchievements } from "./achievements";
import { gameRules, getEconomy } from "@/lib/settings";
```

**Current** (`:81-91`):

```ts
  const meta = GAMES.find((g) => g.id === gameId);
  if (!meta) return fail("Unknown game.");
  // The panel can switch a single game off or move its bet bounds; the catalog
  // metadata is only the fallback, so a settings document written before a game
  // existed can never make that game unplayable.
  const rules = await gameRules(meta.id, { minBet: meta.minBet, maxBet: meta.maxBet });
  if (!rules.enabled) return fail("This game is currently switched off.");
  bet = Math.floor(bet);
```

**Replacement** — import:

```ts
import { getEconomy, getFeatures, getGames } from "@/lib/settings";
```

and the guard:

```ts
  const meta = GAMES.find((g) => g.id === gameId);
  if (!meta) return fail("Unknown game.");
  // All three arcade switches are enforced HERE, not only in the pages: the
  // master switch and the `features.games` flag were honoured by the hub and the
  // API route while this engine settled rounds regardless, so an arcade
  // "switched off" stayed fully playable from the game URL. The panel can also
  // switch a single game off or move its bet bounds; the catalog metadata is only
  // the fallback, so a settings document written before a game existed can never
  // make that game unplayable.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);
  if (!settings.enabled || !features.games) {
    return fail("The arcade is currently switched off.");
  }
  const rules =
    settings.games[meta.id] ?? { enabled: true, minBet: meta.minBet, maxBet: meta.maxBet };
  if (!rules.enabled) return fail("This game is currently switched off.");
  bet = Math.floor(bet);
```

(`gameRules` is no longer used anywhere; its export in `settings.ts` can stay.)

### File 2 of 3 — `src/app/[locale]/games/page.tsx` (the hub)

**Current** (`:8` and `:54-61`):

```tsx
import { getGames } from "@/lib/settings";
```

```tsx
  // A game switched off in the panel disappears from the hub; playGame rejects
  // it too, so hiding the tile is a courtesy, not the enforcement. The bet
  // bounds shown on each tile come from the same settings, so a tile can never
  // advertise a range the engine would refuse.
  const settings = await getGames(GAMES);
  const visible = settings.enabled
    ? GAMES.filter((game) => settings.games[game.id]?.enabled !== false)
    : [];
```

**Replacement** — import:

```tsx
import { getFeatures, getGames } from "@/lib/settings";
```

and:

```tsx
  // BOTH switches gate the hub. The hub used to honour the master switch only,
  // so a `features.games=false` arcade still listed all thirteen tiles while
  // every round answered 403. The bet bounds shown on each tile come from the
  // same settings, so a tile can never advertise a range the engine would refuse.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);
  const visible =
    settings.enabled && features.games
      ? GAMES.filter((game) => settings.games[game.id]?.enabled !== false)
      : [];
```

**Current** (`:93-118`):

```tsx
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((game) => {
          const range = settings.games[game.id] ?? game;
          return (
          <Link
            key={game.id}
            href={`/games/${game.id}`}
            className="card card-interactive flex flex-col gap-2 p-5"
          >
            <span className="text-accent">
              <GameIcon id={game.id} size={30} />
            </span>
            <h2 className="font-bold leading-tight">{t(`${game.id}Title`)}</h2>
            <p className="text-xs leading-relaxed text-muted">{t(`${game.id}Desc`)}</p>
            <div className="mt-auto flex items-center gap-1.5 pt-2">
              <span className="chip pointer-events-none text-[0.5625rem]">
                {game.type === "luck" ? t("luck") : t("skill")}
              </span>
              <span className="chip pointer-events-none text-[0.5625rem]">
                {range.minBet}–{range.maxBet} <Coin size={11} />
              </span>
            </div>
          </Link>
          );
        })}
      </div>
```

**Replacement** — an empty list (master off, feature off, or every game
individually off) shows the existing `games.disabled` copy instead of an empty
grid:

```tsx
      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">{t("disabled")}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((game) => {
            const range = settings.games[game.id] ?? game;
            return (
            <Link
              key={game.id}
              href={`/games/${game.id}`}
              className="card card-interactive flex flex-col gap-2 p-5"
            >
              <span className="text-accent">
                <GameIcon id={game.id} size={30} />
              </span>
              <h2 className="font-bold leading-tight">{t(`${game.id}Title`)}</h2>
              <p className="text-xs leading-relaxed text-muted">{t(`${game.id}Desc`)}</p>
              <div className="mt-auto flex items-center gap-1.5 pt-2">
                <span className="chip pointer-events-none text-[0.5625rem]">
                  {game.type === "luck" ? t("luck") : t("skill")}
                </span>
                <span className="chip pointer-events-none text-[0.5625rem]">
                  {range.minBet}–{range.maxBet} <Coin size={11} />
                </span>
              </div>
            </Link>
            );
          })}
        </div>
      )}
```

`games.disabled` already exists in all 11 locales (`messages/*.json`) and is
currently referenced nowhere — this is what finally uses it, so **no new i18n
keys are needed**.

### File 3 of 3 — `src/app/[locale]/games/[game]/page.tsx` (the detail page)

**Current** (`:3-8` and `:40-58`):

```tsx
import { GAMES } from "@/lib/gamification/games";
import { createClient } from "@/lib/supabase/server";
import { authUserId } from "@/lib/gamification/session";
```

```tsx
export default async function GamePage({ params }: PageProps) {
  const { locale, game } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const meta = GAMES.find((g) => g.id === game);
  if (!meta) notFound();

  const userId = await authUserId();
  if (!userId) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t(`${game}Title`)}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">{t("loginRequired")}</p>
        <div className="mt-8">
          <TwitchLoginButton />
        </div>
      </div>
    );
  }
```

**Replacement** — import:

```tsx
import { GAMES } from "@/lib/gamification/games";
import { createClient } from "@/lib/supabase/server";
import { authUserId } from "@/lib/gamification/session";
import { getFeatures, getGames } from "@/lib/settings";
```

and the gate, inserted between `if (!meta) notFound();` and the login check:

```tsx
  const meta = GAMES.find((g) => g.id === game);
  if (!meta) notFound();

  // The playable board is gated by all three arcade switches, not only the hub's
  // tile list. With the master off or `features.games` disabled the page used to
  // render a full board whose every round the engine refuses; a single game
  // switched off in the panel rendered the board and showed a raw English error
  // per round. Master / feature off show the arcade-off card; a single disabled
  // game 404s, matching the hub hiding its tile.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);
  if (!settings.enabled || !features.games) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t(`${game}Title`)}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">{t("disabled")}</p>
      </div>
    );
  }
  if (settings.games[game]?.enabled === false) notFound();

  const userId = await authUserId();
```

### Why this is correct

The engine is the only place a round can be said to be *refused*; the pages only
decide what to render. Putting the master/feature check in `playGame` makes the
kill switch real for every caller (the route, and any future one), and the two
pages then agree with it. Using `getGames(GAMES)` in the engine reproduces the
existing `gameRules` result exactly (same settings key, same `enabled !== false`
default), so no per-game behaviour changes.

### Design choice

- For the single-game-off detail page I chose `notFound()` over rendering
  `games.disabled`, because that key's copy is specifically about the whole
  arcade. A 404 is consistent with the hub already hiding the tile, and avoids
  adding a key to 11 locales. If the parent prefers a message, the honest fix is
  a new `games.gameOff` key across all 11 files — say so and I will supply the
  translations; but 404 is the smaller, self-consistent change.

### What it must not break

- With defaults (no stored `games`/`features` document, or `enabled` absent),
  `getGames` returns `enabled: true` and `getFeatures` returns `games: true`, so
  the arcade behaves exactly as today.
- The API route keeps its 403 for `features.games`; the engine's new check is
  only reached if the route's is removed.
- The `.catch`-guarded reads in `settings.ts` mean an un-migrated DB still
  returns the defaults (arcade on), not an error page.

### Risk if wrong

The only real risk is a switch read inverted. `getGames` sets
`enabled: stored?.enabled !== false`, so an absent document is *on*; the guard is
`if (!settings.enabled || !features.games)` — off only when explicitly off.
`settings.games[game]?.enabled === false` is strict, so an absent per-game entry
stays on. A regression here would most visibly be "the arcade vanished for
everyone" — caught by the first verification query below.

### Verify afterwards

- Happy path: with no switches touched, `GET /<locale>/games` lists 13 tiles,
  `GET /<locale>/games/rps` renders the board, a round settles (coins move).
- Master off (admin panel `games.enabled=false`), then: `GET /<locale>/games`
  shows the disabled card; `GET /<locale>/games/rps` shows the disabled card;
  `POST /api/games/play {"game":"rps","bet":10}` → `400`, body
  `{"ok":false,"error":"The arcade is currently switched off."}`, and
  `select count(*) from game_rounds where user_id='<me>';` does not increase.
- `features.games=false`: hub shows the disabled card (previously 13 tiles),
  detail shows the card, round is refused.
- One game off (`games.games.rps.enabled=false`): hub omits the RPS tile;
  `GET /<locale>/games/rps` → 404; `POST …/rps` → 400.

---

## Item 20 — the daily / wheel gate commits before the award

**Severity: medium.** A transient `award()` failure consumes the whole day's
bonus or spin; the retry is answered `already` and the wheel's `wheel_spins`
counts a spin that never paid.

The two gates are single RPCs and the reward is a second transaction, so no pure
in-JS reordering fixes it. The fix is a compensating release, in the same
"optimistic guard" idiom already used in `games.ts` and `daily.ts` (void the
raced row) — plus two tiny SQL functions, because the wheel release must undo a
counter increment atomically.

### File 1 of 3 — `supabase/migrations/0034_release_failed_gates.sql` (new)

```sql
-- ============================================================
-- A failed reward used to consume the day's gate.
--
-- `claimDaily` / `spinWheel` commit their once-per-day gate
-- (`claim_daily_gate` / `claim_wheel_gate`) in one transaction and then pay the
-- reward with `award()` in a second. If the second transaction fails — a
-- transient `apply_xp_coins` error, a statement timeout, a read failure inside
-- `award` — the gate is already consumed: `last_login_date` / `last_wheel_date`
-- (and `wheel_spins`) have advanced, nothing was paid, and the retry is answered
-- "already claimed". There is no recovery path, and the wheel's `wheel_spins`
-- counter is incremented with nothing paid.
--
-- These two functions reverse a gate that is still in TODAY's state, in one
-- atomic statement, so the caller can release it from a `catch` and let the user
-- retry. They are guarded on `= p_today`, so a gate that has since moved on is
-- never touched, and they are service-role only — the same contract as the
-- gates themselves (0007 / 0008).
-- ============================================================

-- 1) Release the daily gate. Re-opening means making `last_login_date` differ
--    from today without corrupting the streak arithmetic: `p_today - 1` makes
--    the retry recompute exactly the streak the failed claim would have had
--    (the gate's `last_login_date = p_today - 1` branch yields streak + 1, and
--    the decremented `login_streak` is what it adds to). `best_login_streak` is
--    a high-water mark and is deliberately left alone: the retry re-derives it.
create or replace function public.release_daily_gate(p_user_id uuid, p_today date)
returns void
language sql
as $$
  update public.user_progress
     set last_login_date = p_today - 1,
         login_streak = greatest(0, login_streak - 1),
         updated_at = now()
   where user_id = p_user_id
     and last_login_date = p_today;
$$;

-- 2) Release the wheel gate. Undoes the date AND the spin-counter increment the
--    gate applied, in the same statement, so a reopened retry cannot be counted
--    as a second, unpaid spin.
create or replace function public.release_wheel_gate(p_user_id uuid, p_today date)
returns void
language sql
as $$
  update public.user_progress
     set last_wheel_date = p_today - 1,
         wheel_spins = greatest(0, wheel_spins - 1),
         updated_at = now()
   where user_id = p_user_id
     and last_wheel_date = p_today;
$$;

revoke all on function public.release_daily_gate(uuid, date) from public;
revoke all on function public.release_wheel_gate(uuid, date) from public;
revoke all on function public.release_daily_gate(uuid, date) from anon, authenticated;
revoke all on function public.release_wheel_gate(uuid, date) from anon, authenticated;
grant execute on function public.release_daily_gate(uuid, date) to service_role;
grant execute on function public.release_wheel_gate(uuid, date) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Economy: a failed reward no longer consumes the daily / wheel gate',
  'The daily login bonus and the wheel gate commit their once-per-day claim in a separate transaction from the reward, so a transient failure in award() spent the whole day: the gate advanced, nothing was paid, and the retry was answered "already claimed". Two service-role-only functions, release_daily_gate and release_wheel_gate, reverse a gate that is still in today''s state in a single atomic statement, so the caller can release it from a catch and let the user retry; the wheel release also undoes the wheel_spins increment it applied. Both are guarded on the gate still pointing at today, so a gate that has since moved on is never touched.',
  '{"version": "atomic-counters-1.1"}'::jsonb
);
```

### File 2 of 3 — `src/lib/gamification/daily.ts`

**Current** (`:44-53`):

```ts
  await award(userId, {
    xp,
    coins,
    source: "daily",
    feedKind: "daily",
    feedTitle: `claimed the daily bonus (day ${streak} streak)`,
    payload: { streak, bonus },
  });

  return { ok: true, xp, coins, streak };
```

**Replacement**:

```ts
  try {
    await award(userId, {
      xp,
      coins,
      source: "daily",
      feedKind: "daily",
      feedTitle: `claimed the daily bonus (day ${streak} streak)`,
      payload: { streak, bonus },
    });
  } catch (error) {
    // The gate and the reward are two transactions. A failed award would spend
    // the whole day's bonus — the gate is committed, nothing was paid, and the
    // retry is answered "already" — so release the gate and rethrow; the client's
    // retry then succeeds. A release that itself fails is only logged: the
    // original failure is the one the caller must see.
    try {
      const release = await supabase.rpc("release_daily_gate", {
        p_user_id: userId,
        p_today: todayStr,
      });
      if (release.error) throw release.error;
    } catch (releaseError) {
      console.warn("[daily] could not release the gate after a failed award:", releaseError);
    }
    throw error;
  }

  return { ok: true, xp, coins, streak };
```

### File 3 of 3 — `src/lib/gamification/wheel.ts`

**Current** (`:66-74`):

```ts
  await award(userId, {
    xp: slot.xp,
    coins: slot.coins,
    source: "wheel",
    skipAchievements: false,
    feedKind: "wheel",
    feedTitle: `spun the Wheel of Fortune: ${slot.label}`,
    payload: { slot: slot.id },
  });

  if (turboWon) {
```

**Replacement**:

```ts
  try {
    await award(userId, {
      xp: slot.xp,
      coins: slot.coins,
      source: "wheel",
      skipAchievements: false,
      feedKind: "wheel",
      feedTitle: `spun the Wheel of Fortune: ${slot.label}`,
      payload: { slot: slot.id },
    });
  } catch (error) {
    // Same reasoning as the daily gate: the gate already advanced
    // `last_wheel_date` and `wheel_spins`, so a failed award would burn the
    // day's spin with nothing paid and no way to retry. Release it (date AND the
    // counter, atomically) and rethrow. Only the award is wrapped — the turbo
    // path below must not re-open the gate after a paid spin.
    try {
      const release = await supabase.rpc("release_wheel_gate", {
        p_user_id: userId,
        p_today: today(),
      });
      if (release.error) throw release.error;
    } catch (releaseError) {
      console.warn("[wheel] could not release the gate after a failed award:", releaseError);
    }
    throw error;
  }

  if (turboWon) {
```

### Why this is correct

`award()` throws only from its two atomic RPCs (`apply_xp_coins`,
`consume_and_apply_game_xp`) and from `getProgress` — all of which are single
statements, so a throw means **nothing was paid** (no XP, no coins, no feed row;
`logActivity` is called only after the apply succeeds). Releasing the gate is
therefore always the correct compensation: the user retries and gets exactly the
streak/prize they were entitled to.

The release is `WHERE last_login_date = p_today` (resp. `last_wheel_date =
p_today`), so it is a no-op if the state has moved on, which makes it idempotent
and safe under a concurrent retry. Setting the date to `p_today - 1`
deterministically re-opens today and reproduces the pre-claim streak arithmetic
(verified across the broken-streak, continuous-streak and first-claim cases in
the migration comment).

### Design choice

The alternative — a JS compensating `update` — cannot undo the wheel's
`wheel_spins` increment atomically (`supabase-js` can't express `wheel_spins =
wheel_spins - 1`), so it would need a second call with a race window between
reopening the gate and decrementing. One atomic SQL statement per gate is the
correct shape and matches 0007/0008. Chosen: SQL.

### What it must not break

- Happy path never enters the `catch`, so the gate/reward ordering on success is
  unchanged.
- `best_login_streak` is not touched by the release; the retry re-derives it, and
  a release that is never retried leaves a best that is at most the streak that
  momentarily existed (never above a threshold the user did not actually reach
  on a later successful claim — the residual is a cosmetic max that the next
  successful claim overwrites to its true value or higher).
- No client contract changes: the route still maps `ok:false` to 429.

### Risk if wrong

If `release_daily_gate` were unguarded (`= p_today` dropped), a late release
could reopen a day whose bonus was already paid, letting it be claimed twice.
The guard is the load-bearing part; keep it. If the guard's column is wrong
(`last_wheel_date` vs `last_login_date`) the release silently no-ops and the bug
persists undetected — the verify step below exercises both.

### Verify afterwards

- `select has_function_privilege('anon','public.release_daily_gate(uuid,date)',
  'execute'), has_function_privilege('authenticated',
  'public.release_wheel_gate(uuid,date)','execute');` → both `false`.
- Simulate the failure: in a scratch/`node -e` harness call
  `claim_daily_gate` for a test user, then call `release_daily_gate`; check
  `select last_login_date, login_streak from user_progress where user_id='<u>';`
  → `last_login_date` is yesterday, `login_streak` is the pre-claim value, and a
  second `claim_daily_gate` returns the same streak (not `-1`).
- Wheel: `claim_wheel_gate` (spins+1), `release_wheel_gate` → `last_wheel_date`
  is yesterday and `wheel_spins` is back to its previous value; a second
  `claim_wheel_gate` returns `true`.

---

## Item 13 — `k_vault_master` reads a flag nothing emits

**Severity: medium.** A permanently locked achievement (500 XP / 250 coins / 25
points) listed as obtainable.

### File 1 of 2 — `src/lib/gamification/games.ts` (vault result, `:448-459`)

**Current**:

```ts
      const matches = clampInt(input.matches, 0, 3);
      const chance = [0.05, 0.15, 0.29, 0.45][matches];
      const won = Math.random() < chance;
      return {
        payout: won ? bet * 2 : 0,
        result: { matches, chance, won, perfect: matches === 3 },
      };
```

**Replacement** — keep `perfect` (the flag the achievement should read) and gate
it on the win, same rule as item 12:

```ts
      const matches = clampInt(input.matches, 0, 3);
      const chance = [0.05, 0.15, 0.29, 0.45][matches];
      const won = Math.random() < chance;
      return {
        payout: won ? bet * 2 : 0,
        // `perfect` means all three needles landed AND the vault actually opened
        // — the achievement reads it, and `matches` is a client claim, so gating
        // on `won` keeps a forged `matches: 3` from banking it on a loss.
        result: { matches, chance, won, perfect: won && matches === 3 },
      };
```

### File 2 of 2 — `src/lib/gamification/achievements.ts` (`:170`)

**Current**:

```ts
  CREATIVE("k_vault_master", "Vault Cracker", "Crack the vault perfectly three times.", (s) => hasFlag(s, "vault", "perfect3")),
```

**Replacement** — read the flag the resolver emits, and count three of them (the
description says "three times", which a single `hasFlag` cannot express):

```ts
  // "three times" needs a count, not a has-any: the resolver emits `perfect` for
  // a single flawless crack, and a `perfect3` flag was never written by anything,
  // so this was unreachable. The 60-round window is the same one `hasFlag` reads.
  CREATIVE("k_vault_master", "Vault Cracker", "Crack the vault perfectly three times.",
    (s) => s.recentResults.filter((r) => r.game === "vault" && r.flags?.perfect === true).length >= 3),
```

### Why this is correct

`grep -rn "perfect3" src/` returns only the old definition — the vault resolver
emits `perfect`. Reading `perfect` makes the flag name match, and counting three
matches the description instead of downgrading the achievement to one crack.
Gating the emitted flag on `won` is the item-12 rule applied to the one
client-reported skill flag the report's F2 list did not name.

### Design choice

- **Count three `perfect` rounds (recommended)** — matches the stated condition,
  bounded by the same 60-round window `hasFlag` already uses (so it shares
  `k_marathon_day`'s window caveat, but three perfect cracks inside 60 rounds is
  a realistic ask).
- **Read `perfect` once and reword to "Crack the vault perfectly."** — simplest,
  but turns a "three times" achievement into a single-round one and inflates its
  ease. Not recommended.

The `won` gate is a recommendation, not part of the name-mismatch defect; if the
parent prefers vault's "perfect crack" to mean "all three needles in the green
zone" regardless of the RNG, drop `won &&` from `games.ts` and the count still
works. I recommend keeping it, because otherwise three forged `matches: 3`
payloads unlock it outright.

### What it must not break

- No other consumer of vault's `perfect` (verified by grep). `k_vault_master` is
  the only reader, and was always false before, so nothing that previously
  unlocked regresses.
- `s_vault`-style payout achievements do not exist for vault; the payout is
  untouched.

### Risk if wrong

The count reads `recentResults`, which is the 60 most recent rounds ordered by
`created_at desc` — a player whose three perfect cracks span more than 60 rounds
will not unlock. That is a known, bounded limitation shared with `hasFlag`; it
is strictly better than "never". If the parent wants it unbounded, it needs the
same treatment as `k_marathon_day` (a dedicated count query in `buildStats`),
which I would only add if three-in-60 is judged too tight.

### Verify afterwards

- `npm run typecheck`.
- As a test account, POST `{"game":"vault","bet":10,"input":{"matches":3}}`
  repeatedly; on a **losing** round
  `select result->>'perfect' from game_rounds order by created_at desc limit 1;`
  is `false`; on a winning one it is `true`. After three winning perfect rounds,
  `select achievement_id from user_achievements where user_id='<u>' and
  achievement_id='k_vault_master';` has one row.

---

## Item 14 — `k_marathon_day` (100 rounds/day) can never unlock

**Severity: medium.** `roundsToday` is a slice of a 60-row window, so `>= 100`
is unsatisfiable.

### File — `src/lib/gamification/achievements.ts`

**Current** (`:405-423`, the relevant part of `buildStats`):

```ts
async function buildStats(userId: string): Promise<AchStats> {
  const supabase = createAdminClient();
  const progress = await getProgress(userId);

  const [badgesRes, gamesRes, roundsRes, wheelRes, turboRes, profileRes,
    rainRes, stealRes, reactRes, visitsRes, usersRes, topCoinsRes, achRes, visitorsRes,
    maxBetRes] =
    await Promise.all([
      supabase.from("user_inventory").select("badges(rarity_tier,status,set_id,first_seen_at,rarity_score)").eq("user_id", userId),
```

and (`:422`):

```ts
      supabase.from("game_rounds").select("game,won,bet,payout,result,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
```

and (`:515-518`):

```ts
  const wheelBest = Math.max(0, ...((wheelRes.data ?? []) as Array<{ xp_amount: number | null }>).map((r) => r.xp_amount ?? 0));
  const todayStr = new Date().toISOString().slice(0, 10);
  const rawRounds = (roundsRes.data ?? []) as Array<Record<string, unknown>>;
  const roundsToday = rawRounds.filter((r) => String(r.created_at).slice(0, 10) === todayStr).length;
```

**Replacement**:

Destructuring — add `todayRoundsRes` right after `roundsRes`:

```ts
  const [badgesRes, gamesRes, roundsRes, todayRoundsRes, wheelRes, turboRes, profileRes,
    rainRes, stealRes, reactRes, visitsRes, usersRes, topCoinsRes, achRes, visitorsRes,
    maxBetRes] =
```

Move the UTC-day string above the `Promise.all` (it is needed by the new query),
then add the count promise immediately after the 60-row `roundsRes` promise:

```ts
  const wheelBest = ...
```

Actually, place the declaration and the promise precisely. Before `const [badgesRes, …]`:

```ts
  const progress = await getProgress(userId);
  const todayStr = new Date().toISOString().slice(0, 10);
```

and in the array, after the existing 60-row `roundsRes` line (`:422`), insert:

```ts
      // A TRUE count of today's rounds. `roundsToday` used to be derived from the
      // 60-row window above (bounded at 60), so k_marathon_day's "100 rounds in a
      // single day" could never pass; a head-count is not clamped by PostgREST's
      // 1000-row response cap.
      supabase
        .from("game_rounds")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", `${todayStr}T00:00:00.000Z`),
```

and replace the two lines at `:516-518`:

```ts
  const rawRounds = (roundsRes.data ?? []) as Array<Record<string, unknown>>;
  // The full-day count, not the 60-row window (see the query above).
  const roundsToday = todayRoundsRes.count ?? 0;
```

(delete the old `const todayStr = …` line at `:516` — it now lives above the
`Promise.all`; `hoursToday` below still uses `rawRounds`/`todayStr` and is
unchanged.)

### Why this is correct

PostgREST's `count: "exact", head: true` returns the row count of the filter
independent of the 1000-row response cap and of any `limit`, so this is the true
number of rounds started since 00:00 UTC today. `roundsToday` feeds
`k_marathon_day` (>= 100) and `k_weekend_warrior` (>= 10 on a weekend) — both
become correct.

### Design choice

Versus lowering the description's threshold to fit the window (e.g. "play 60
rounds in a day"): a 100-round day is a legitimate, desirable goal and the
catalog is meant to be aspirational, not window-bounded. Recommend the real
count and keep the description. This also fixes `k_weekend_warrior` for free.

### What it must not break

- `hoursToday` / `distinctHoursToday` (a dead stat — computed, never read) keep
  using the 60-row `rawRounds`; unchanged.
- One extra head-count query per `evaluateAchievements` run. It is a cheap
  indexed count; `game_rounds` has a `(user_id, created_at)` access path via the
  existing ordering index — if it does not, add one, but verify with `EXPLAIN`
  first rather than pre-emptively.

### Risk if wrong

If `todayStr` interpolation produced a malformed timestamp the query would
error; `pageAll`-style behaviour does not apply here (this is a plain `await`),
so an error would surface as `todayRoundsRes.error` and `count` would be `null`
→ `roundsToday = 0` (the achievement quietly not unlocking, never a crash). The
format `${todayStr}T00:00:00.000Z` is valid ISO and compares correctly against a
`timestamptz` column. Low risk.

### Verify afterwards

- SQL: `select count(*) from game_rounds where user_id='<u>' and created_at >=
  date_trunc('day', now() at time zone 'utc');` after 100 rounds must be 100, and
  `select achievement_id from user_achievements where user_id='<u>' and
  achievement_id='k_marathon_day';` must have a row.
- `k_weekend_warrior` on a weekend after 10 rounds similarly.

---

## Item 15 — `k_retro_2017` measures the catalog's detection year

**Severity: medium.** `oldestBadgeYear` is `badges.first_seen_at`'s year, which
is 2026 for the whole catalog by construction, so `<= 2017` never fires.

### File — `src/lib/gamification/achievements.ts`

**Current** (`:413`, the inventory select):

```ts
      supabase.from("user_inventory").select("badges(rarity_tier,status,set_id,first_seen_at,rarity_score)").eq("user_id", userId),
```

**Current** (`:477-483`):

```ts
  const firstSeens = badges.map((b) => String(b.first_seen_at ?? "")).filter(Boolean).sort();
  const newestAgeH = firstSeens.length
    ? (Date.now() - new Date(firstSeens[firstSeens.length - 1]).getTime()) / 3_600_000
    : 9999;
  const oldestYear = firstSeens.length
    ? new Date(firstSeens[0]).getUTCFullYear()
    : 9999;
```

**Replacement** — add `release_date` to the select:

```ts
      supabase.from("user_inventory").select("badges(rarity_tier,status,set_id,first_seen_at,release_date,rarity_score)").eq("user_id", userId),
```

and compute `oldestYear` from the badge's real release date, leaving
`newestAgeH` (which correctly wants *detection*) on `first_seen_at`:

```ts
  const firstSeens = badges.map((b) => String(b.first_seen_at ?? "")).filter(Boolean).sort();
  const newestAgeH = firstSeens.length
    ? (Date.now() - new Date(firstSeens[firstSeens.length - 1]).getTime()) / 3_600_000
    : 9999;
  // k_retro_2017 wants the badge's real release year, not the year this database
  // detected it: `first_seen_at` is 2026 for the whole catalog (it was built in
  // 2026), so `<= 2017` could never fire no matter which badge was owned.
  // `release_date` is the badgebase release date; a badge without one cannot
  // satisfy "from 2017 or earlier".
  const releaseYears = badges
    .map((b) => (b.release_date ? new Date(String(b.release_date)).getUTCFullYear() : NaN))
    .filter((year) => Number.isFinite(year));
  const oldestYear = releaseYears.length ? Math.min(...releaseYears) : 9999;
```

### Why this is correct

`badges.release_date` is the real release, populated by the badgebase sync
(`src/lib/syncs/badgebase.ts`), while `first_seen_at` is a detection default
(`default now()`). The achievement's description is about the badge, not about
the catalog, so it must read the release. `k_fresh_drop` keeps `first_seen_at`
because "within 48 hours of its **detection**" is exactly what it says.

### Design choice

- **`release_date` only (recommended).** The report says the live catalog has 0
  badges with `release_date < 2018` today, so the achievement stays legitimately
  locked until an older badge enters the catalog — "locked because no such badge
  exists yet" is honest, unlike "locked by a wrong field".
- **`release_date ?? start_date` fallback** would reintroduce date-arithmetic
  ambiguity (a 2026 claim window is not a 2017 badge) and is not recommended.

### What it must not break

- `newestAgeH` / `k_fresh_drop` still read `first_seen_at`.
- `oldestBadgeYear` is read only by `k_retro_2017` (verified by grep).

### Risk if wrong

If `release_date` is stored as a string without a timezone and parsed as local
time, a Jan-1 midnight boundary could shift a year by one — negligible, and the
same parsing pattern is already used for `first_seen_at`. If badgebase stores
`release_date` as null for most badges, the achievement simply stays locked
(false negative), never a false positive.

### Verify afterwards

- `select min(release_date) from badges;` and
  `select count(*) from badges where release_date < '2018-01-01';` — today both
  say 0 / null, so the achievement should be locked for every account; the check
  is now gated on the right column.
- If a test badge with `release_date = '2017-06-01'` is added to the catalog and
  owned, `k_retro_2017` unlocks.

---

## Item 16 — `k_slots_scatter` fires on a single scatter symbol

**Severity: low-medium.** The achievement's stated "3+" is read through
truthiness of a count, so one scatter column unlocks it; the correct boolean is
already computed and unused.

### File — `src/lib/gamification/achievements.ts` (`:195`)

**Current**:

```ts
  CREATIVE("k_slots_scatter", "Scatter! ", "Land 3+ scatter badges in Badges of Ra.", (s) => hasFlag(s, "slots", "scatter")),
```

**Replacement** — read the server-computed boolean instead of the count:

```ts
  CREATIVE("k_slots_scatter", "Scatter! ", "Land 3+ scatter badges in Badges of Ra.", (s) => hasFlag(s, "slots", "scatterHit")),
```

### Why this is correct

`games.ts:312` stores both `scatter` (the column count, 0–5) and
`scatterHit: scatter >= 3`; `hasFlag` tests truthiness, so `scatter === 1`
unlocked the achievement even though no bonus was paid. `scatterHit` is exactly
the description's predicate and is currently read by nothing.

### What it must not break

- `scatter` (the count) is still stored and still used by nothing else that
  changes; `s_slots_jackpot` reads `payout`, untouched.
- Slots is server-rolled (`slotSymbols`, `weightedSymbol`), so the flag is
  already server-authoritative — no win-gating needed.

### Risk if wrong

If `scatterHit` were ever renamed the achievement would go permanently false
(a silent lock); grep after editing: `grep -rn scatterHit src/` must show both
`games.ts` (writer) and `achievements.ts` (reader).

### Verify afterwards

- `grep -rn 'scatterHit' src/` → two hits.
- Spin slots until exactly one scatter column appears; confirm
  `k_slots_scatter` is **not** unlocked; then with 3+ scatter columns it is.

---

## Item 17 — `k_scratch_jackpot`: fires at 1.4×, 20× unreachable

**Severity: low-medium.** The achievement says "Win a 20× payout", the flag
fires on any 3+ jackpot symbols (multiplier as low as 1.4×), and 20× can never
be drawn.

### File 1 of 2 — `src/lib/gamification/games.ts` (`:476-477`)

**Current**:

```ts
      const jackpot = (counts.get("jackpot") ?? 0) >= 3;
      return { payout: Math.floor(bet * mult), result: { cells, mult, jackpot } };
```

**Replacement** — the flag means the payout, not the symbol count:

```ts
      // The achievement says "20x", but the jackpot branch caps at
      // `min(20, base * 2)` with base ∈ {0.7, 2, 5}, so the largest jackpot-symbol
      // win is 10x (count >= 5) and 20x is unreachable. Key the flag on the payout
      // actually won, so "Golden Scratch" fires on a real 10x, never on the common
      // 1.4x three-of-a-kind.
      const jackpot = mult >= 10;
      return { payout: Math.floor(bet * mult), result: { cells, mult, jackpot } };
```

### File 2 of 2 — `src/lib/gamification/achievements.ts` (`:171`)

**Current**:

```ts
  CREATIVE("k_scratch_jackpot", "Golden Scratch", "Win a 20× payout on a scratch card.", (s) => hasFlag(s, "scratch", "jackpot")),
```

**Replacement** — the description matches what the game can actually pay:

```ts
  CREATIVE("k_scratch_jackpot", "Golden Scratch", "Win a 10× payout on a scratch card.", (s) => hasFlag(s, "scratch", "jackpot")),
```

### Why this is correct

`mult` is the multiplier the round actually paid (the payout is
`floor(bet * mult)`). `mult >= 10` occurs only through the jackpot symbol at
count ≥ 5 (ordinary symbols top out at 5), so the flag now means "won the biggest
thing the table can pay", which is what a jackpot achievement should mean. The
description is corrected to the reachable number instead of the dead 20×.

### Design choice

- **A (recommended): reword to 10× and key the flag on `mult >= 10`.** The
  condition becomes rare but achievable; the EV-verified payout table
  (0.983 over 2M rounds) is untouched.
- **B: make the jackpot branch actually pay 20×** (e.g. `base` for the jackpot
  symbol at count 3 → 20) and keep the 20× copy. This changes the economy and
  requires re-running `scripts/verify-game-economy.ts` and the 2M-round scratch
  simulation before it can be trusted — out of scope for a text/flag fix.

Recommend A. The `Math.min(20, base * 2)` in the payout loop becomes dead code
under A; leave it (it is harmless and changing it risks the EV) or simplify to
`base * 2` with a comment — I'd leave it and note it.

### Not in this fix

The report's F5 also notes that an ordinary three-of-a-kind pays 0.7× (below the
stake, `won:false`) and that `ScratchGame.tsx` renders neither the verdict nor
the payout. That is a payout/clarity issue distinct from "20× is unreachable" and
should be its own decision; I have not folded it in. (If the parent wants the
0.7× removed, it is a one-line `base` change plus a re-simulated EV — say so and
I will spec it separately.)

### What it must not break

- Nothing else reads scratch's `jackpot` (verified by grep); `mult` is returned
  to the client but not consumed for logic.
- EV is unchanged (`jackpot` is signalling only).

### Risk if wrong

If `mult >= 10` were judged too rare (a 5-of-a-kind jackpot is very uncommon),
the achievement becomes near-unreachable — the exact failure mode we are fixing.
The measured distribution in the report puts a 10× jackpot at 41 in 500,000
rounds; that is rare but real, and materially better than "never".

### Verify afterwards

- `node -e` simulation of 9 `scratchSymbol()` draws over ≥ 500k rounds: confirm
  the set of `mult` values includes 10 and that `jackpot` is true only for
  `mult >= 10` (report says the distribution is `1.4 : 6265, 4 : 550, 10 : 41`
  among jackpot-flag rounds before the fix; after the fix only the 41 should
  carry the flag).
- `grep -rn 'Win a 20' src/lib/gamification/achievements.ts` → no hit.

---

## Item 18 — the steal race recheck hardcodes "6/hour"

**Severity: low.** The post-insert guard ignores the admin-editable
`economy.stealPerHour`.

### File — `src/lib/gamification/daily.ts` (`:181`)

**Current**:

```ts
  if ((racedPair ?? 0) > 1 || (racedHour ?? 0) > 6) {
```

**Replacement**:

```ts
  if ((racedPair ?? 0) > 1 || (racedHour ?? 0) > economy.stealPerHour) {
```

### Why this is correct

The pre-check rejects when `recentHour >= economy.stealPerHour` (`:138`), i.e.
the maximum tolerated count in the window is `stealPerHour`. After our row is
inserted, `racedHour` includes it, so the same bound is `> stealPerHour`. With
the default 6 this is identical to the old `> 6`; with a raised limit it stops
voiding legitimate attempts, and with a lowered one it stops tolerating a burst
above the configured cap.

### What it must not break

- Default behaviour is byte-identical (`economy.stealPerHour` defaults to 6 via
  `ECONOMY_DEFAULTS`).
- `economy` is already in scope (read at `:88`).

### Risk if wrong

If the intent were a *separate*, fixed burst ceiling independent of the hourly
limit, this change would couple them. Nothing in the code or the report suggests
that; the two guards exist to enforce the same number, and the report's Direction
is explicitly "the two branches must use the same bound".

### Verify afterwards

- Set `economy.stealPerHour = 20` in the panel; make 7 sequential in-window
  attempts against distinct victims; the 7th must now **succeed** (previously
  returned "Flood check: too many attempts at once.").
- Set it to 3; a 4th attempt in the window must be refused by the pre-check.

---

## Item 19 — `k_night_owl` / `k_early_bird` test the evaluation clock

**Severity: low.** Both predicates read `new Date().getUTCHours()` at evaluation
time and ignore their stats argument, so any award between 00:00 and 07:00 UTC
unlocks "claimed a daily bonus at that hour".

### File — `src/lib/gamification/achievements.ts`

**Current** (`:156-157`):

```ts
  CREATIVE("k_night_owl", "Night Owl", "Claim a daily bonus between 0 and 5 AM.", (s) => new Date().getUTCHours() < 5),
  CREATIVE("k_early_bird", "Early Bird", "Claim a daily bonus before 7 AM UTC.", (s) => new Date().getUTCHours() < 7 && new Date().getUTCHours() >= 5),
```

**Current** (`AchStats`, after `:57`):

```ts
  activityCount: number;
  dailyCount: number;
  userCount: number;
```

**Current** (`buildStats` destructuring `:409-412`, and the tail of the array
`:472`):

```ts
  const [badgesRes, gamesRes, roundsRes, wheelRes, turboRes, profileRes,
    rainRes, stealRes, reactRes, visitsRes, usersRes, topCoinsRes, achRes, visitorsRes,
    maxBetRes] =
```

```ts
      supabase.from("game_rounds").select("bet").eq("user_id", userId).order("bet", { ascending: false }).limit(1).maybeSingle(),
    ]);
```

**Replacement** — add a stat, fill it from the latest daily claim, and read it:

`AchStats`:

```ts
  activityCount: number;
  dailyCount: number;
  /** UTC hour of the most recent daily-bonus claim, or null if none yet. */
  lastDailyHour: number | null;
  userCount: number;
```

Destructuring — add `lastDailyRes` at the end:

```ts
  const [badgesRes, gamesRes, roundsRes, wheelRes, turboRes, profileRes,
    rainRes, stealRes, reactRes, visitsRes, usersRes, topCoinsRes, achRes, visitorsRes,
    maxBetRes, lastDailyRes] =
```

Array — append after the `maxBetRes` promise:

```ts
      supabase.from("game_rounds").select("bet").eq("user_id", userId).order("bet", { ascending: false }).limit(1).maybeSingle(),
      // The hour of the LATEST daily claim, for k_night_owl / k_early_bird: the
      // check must key off when the bonus was claimed, not off the clock at
      // evaluation time (any award between 00:00 and 07:00 UTC used to unlock
      // "claimed a daily bonus at that hour" with no claim at all).
      supabase
        .from("activity_events")
        .select("created_at")
        .eq("user_id", userId)
        .eq("kind", "daily")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
```

Compute it (near the other derived values, e.g. beside `rainRes` handling
`:535`):

```ts
  const lastDailyAt = (lastDailyRes.data as { created_at?: string } | null)?.created_at;
  const lastDailyHour = lastDailyAt ? new Date(String(lastDailyAt)).getUTCHours() : null;
```

Return it (in the returned object, beside `dailyCount`):

```ts
    dailyCount: (achRes.data ?? []).filter((k) => (k as { kind?: string }).kind === "daily").length,
    lastDailyHour,
```

and the two predicates:

```ts
  CREATIVE("k_night_owl", "Night Owl", "Claim a daily bonus between 0 and 5 AM.",
    (s) => s.lastDailyHour !== null && s.lastDailyHour < 5),
  CREATIVE("k_early_bird", "Early Bird", "Claim a daily bonus before 7 AM UTC.",
    (s) => s.lastDailyHour !== null && s.lastDailyHour >= 5 && s.lastDailyHour < 7),
```

### Why this is correct

`claimDaily`'s `award` writes a `kind:"daily"` `activity_events` row *before*
calling `evaluateAchievements` (the feed log precedes the evaluation inside
`award`), so at the moment of the claim the latest daily event is that claim and
`lastDailyHour` is the claim's UTC hour. Using the *latest* daily claim is
sufficient: at a 3 AM claim the stat is 3 and the achievement unlocks then; a
later 10 AM claim sets it to 10 and does not retro-unlock.

### Design choice

Versus "any daily claim ever in that hour" (which would need scanning all daily
events): the latest-claim signal is exact at the moment it matters, costs one
indexed single-row read, and needs no history table. Recommend latest-claim.

### What it must not break

- `dailyCount` / `activityCount` still read `achRes` (the unpaged
  `activity_events` select) unchanged.
- `s_owl_gambler` (`r.won && r.hour === 3`, a *game win* at 3–4 AM) is a
  different, correctly round-anchored check and is untouched.
- The unused-`s` eslint warning on both predicates disappears.

### Risk if wrong

If the daily feed insert fails (`logActivity` swallows errors), `lastDailyHour`
stays stale and the achievement does not unlock that day — a false negative on
an already-fragile path, never a false positive. If `created_at` were a
text column the `getUTCHours()` parse would yield `NaN`; it is `timestamptz`, and
`new Date` handles the ISO form PostgREST returns.

### Verify afterwards

- `select created_at from activity_events where user_id='<u>' and kind='daily'
  order by created_at desc limit 1;` → compare its UTC hour with
  `select achievement_id from user_achievements where user_id='<u>' and
  achievement_id in ('k_night_owl','k_early_bird');`.
- Behavioural: play one game at 03:00 UTC **without** claiming the daily; neither
  achievement unlocks (previously `k_night_owl` did).

---

## Item 21 — `/api/feed` (and the feed page) ignores `features.feed`

**Severity: low.** The flag hides the nav entry but leaves the data at
`/api/feed?limit=50` and the page fully rendered.

### File 1 of 2 — `src/app/api/feed/route.ts`

**Current** (`:1-9`):

```ts
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Public live feed: latest activities across all users. */
export async function GET(request: Request) {
  const url = new URL(request.url);
```

**Replacement**:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { getFeatures } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Public live feed: latest activities across all users. */
export async function GET(request: Request) {
  // The flag removes the feature, not just the nav link: with the feed switched
  // off the endpoint used to keep serving the full public feed at /api/feed.
  const features = await getFeatures();
  if (!features.feed) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(request.url);
```

### File 2 of 2 — `src/app/[locale]/feed/page.tsx`

**Current** (`:1-4` and `:32-37`):

```tsx
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import FeedList, { type FeedEvent } from "@/components/FeedList";
```

```tsx
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("feed");

  let initialEvents: FeedEvent[] = [];
```

**Replacement** — import `notFound` and `getFeatures`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/settings";
import FeedList, { type FeedEvent } from "@/components/FeedList";
```

and gate the body:

```tsx
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("feed");

  // The endpoint 404s on the same switch, so the page and the API agree.
  const features = await getFeatures();
  if (!features.feed) notFound();

  let initialEvents: FeedEvent[] = [];
```

### Why this is correct

`features.feed` is a real operator switch (the Header already hides the link for
it). The consistent behaviour for "feature off" is that both the page and the
endpoint disappear — hence `notFound()` on the page and `404` on the API, so the
endpoint does not announce a refusal it could otherwise be probed for. Returning
404 from both keeps them in agreement.

### Design choice

`404` vs `403`: `/api/games/play` and `/api/wheel/spin` return `403
"feature disabled"` because those are mutating actions a logged-in user is
actively attempting. `/api/feed` is a public read for a feature that is simply
gone; `404` matches the page's `notFound()` and hides the surface. If the parent
prefers one convention for all feature switches, use `403` on both the route and
supply a page-level message instead of `notFound()` — but then the page needs a
"feature disabled" key. Recommend `404` for the low-friction, no-new-i18n path.

### What it must not break

- With `features.feed` default `true`, both behave exactly as today.
- The route's cursor/limit parsing and payload projection are untouched (they now
  sit below the gate).

### Risk if wrong

If `getFeatures()` threw, the route would 500 instead of serving — but
`getFeatures` catches internally and falls back to `FEATURE_DEFAULTS` (feed on),
so the only failure mode is "feed stays on". The page's `notFound()` is inside
the component body, so metadata still generates — harmless.

### Verify afterwards

- Default: `GET /api/feed` → 200 with events; `/<locale>/feed` → 200.
- Set `features.feed = false`: `GET /api/feed` → 404 `{"error":"not found"}`;
  `/<locale>/feed` → 404 page; the nav link is already hidden.

---

## Item 23 — the turbo slot's declared weight is 10× the drawn probability

**Severity: low.** `WHEEL_SLOTS`'s turbo `weight: 1e-7` disagrees with the real
draw (1e-8) and is dead code (turbo is excluded from `weightedPick`), so any
consumer deriving odds from `WHEEL_SLOTS` would publish 1 : 10,000,000.

### File — `src/lib/gamification/wheel.ts`

**Current** (`:20-31`):

```ts
export const WHEEL_SLOTS: WheelSlot[] = [
  { id: "xp25", label: "+25 XP", xp: 25, coins: 10, weight: 4000 },
  { id: "xp50", label: "+50 XP", xp: 50, coins: 20, weight: 2500 },
  { id: "xp100", label: "+100 XP", xp: 100, coins: 40, weight: 1500 },
  { id: "xp250", label: "+250 XP", xp: 250, coins: 100, weight: 700 },
  { id: "xp500", label: "+500 XP", xp: 500, coins: 200, weight: 220 },
  { id: "xp1000", label: "+1,000 XP", xp: 1000, coins: 400, weight: 70 },
  { id: "xp2500", label: "+2,500 XP", xp: 2500, coins: 1000, weight: 10 },
  { id: "turbo", label: "Twitch Turbo!", xp: 5000, coins: 50000, weight: 0.0000001, turbo: true },
];

const TURBO_PROBABILITY = 0.00000001;
```

**Replacement** — hoist the constant above the table and bind the weight to it,
so the declared odds are the drawn odds by construction:

```ts
/**
 * The Turbo slot's win probability. The slot is drawn SEPARATELY from the
 * weighted pick (see spinWheel), so its `weight` is informational — but it must
 * still be the real probability, or any consumer deriving odds from WHEEL_SLOTS
 * publishes 1 : 10,000,000 while the UI says 1 : 100,000,000.
 */
const TURBO_PROBABILITY = 0.00000001;

export const WHEEL_SLOTS: WheelSlot[] = [
  { id: "xp25", label: "+25 XP", xp: 25, coins: 10, weight: 4000 },
  { id: "xp50", label: "+50 XP", xp: 50, coins: 20, weight: 2500 },
  { id: "xp100", label: "+100 XP", xp: 100, coins: 40, weight: 1500 },
  { id: "xp250", label: "+250 XP", xp: 250, coins: 100, weight: 700 },
  { id: "xp500", label: "+500 XP", xp: 500, coins: 200, weight: 220 },
  { id: "xp1000", label: "+1,000 XP", xp: 1000, coins: 400, weight: 70 },
  { id: "xp2500", label: "+2,500 XP", xp: 2500, coins: 1000, weight: 10 },
  { id: "turbo", label: "Twitch Turbo!", xp: 5000, coins: 50000, weight: TURBO_PROBABILITY, turbo: true },
];
```

(delete the now-duplicated `const TURBO_PROBABILITY = 0.00000001;` line that
followed the array.)

### Why this is correct

`spinWheel` draws turbo at `Math.random() < TURBO_PROBABILITY` and picks the
displayed slot from `WHEEL_SLOTS.slice(0, -1)`; the turbo row's `weight` is
never used in the pick, so the change is purely declarative and cannot alter any
draw. Binding it to the constant removes the 10× drift and prevents the two
values diverging again.

### What it must not break

- Draw behaviour is identical: turbo is drawn before `weightedPick`, which still
  excludes the last slot. `turboOdds` copy (1 : 100,000,000) is unchanged and now
  agrees with both numbers.
- No consumer currently reads `WHEEL_SLOTS`'s turbo weight (the report's
  duplicate-table hazard is the client `SEGMENTS`, intentionally left alone here
  — a separate documentation/maintenance item, not this fix).

### Risk if wrong

Only a hoist/TDZ error could break module init: `TURBO_PROBABILITY` must be
defined before `WHEEL_SLOTS` (it is, in the replacement). If left below the
array, the initializer would throw a `ReferenceError` at import — caught by
`npm run build`/`typecheck`.

### Verify afterwards

- `npm run typecheck && npm run build` (a TDZ error fails the build).
- `grep -n "weight: TURBO_PROBABILITY" src/lib/gamification/wheel.ts` → one hit;
  `grep -c "const TURBO_PROBABILITY" src/lib/gamification/wheel.ts` → 1.

---

## Item 52 — `useGame.play()` has no in-flight guard (Vault's "again")

**Severity: low.** A second `/api/games/play` can be issued while the first
settles, charging a second round and racing two responses into `last`/`balance`.

### File 1 of 2 — `src/components/games/useGame.tsx`

**Current** (`:3`, `:18-25`, `:41-67`):

```ts
import { useCallback, useEffect, useState } from "react";
```

```ts
export function useGame(gameId: string) {
  const t = useTranslations("games");
  const [balance, setBalance] = useState<number | null>(null);
  const [bet, setBet] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<PlayResponse | null>(null);
```

```ts
  const play = useCallback(
    async (input: Record<string, unknown> = {}): Promise<PlayResponse | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/games/play", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ game: gameId, bet, input }),
        });
        const data = (await res.json()) as PlayResponse;
        if (!data.ok) {
          setError(data.error ?? "Round failed");
          return null;
        }
        setLast(data);
        setBalance(data.balance);
        return data;
      } catch {
        setError("Network error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [bet, gameId],
  );
```

**Replacement** — import `useRef`, add a ref guard (covers all thirteen games,
not just Vault):

```ts
import { useCallback, useEffect, useRef, useState } from "react";
```

```ts
export function useGame(gameId: string) {
  const t = useTranslations("games");
  const [balance, setBalance] = useState<number | null>(null);
  const [bet, setBet] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<PlayResponse | null>(null);
  // A ref, not the `busy` state: a state transition can fire play() again in the
  // same commit, before `busy` has re-rendered (Vault's "again" did exactly this),
  // so the guard must be synchronous.
  const inFlight = useRef(false);
```

```ts
  const play = useCallback(
    async (input: Record<string, unknown> = {}): Promise<PlayResponse | null> => {
      // One round at a time: a second call while a round is open would charge a
      // second bet and race two responses into `last`/`balance`.
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/games/play", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ game: gameId, bet, input }),
        });
        const data = (await res.json()) as PlayResponse;
        if (!data.ok) {
          setError(data.error ?? "Round failed");
          return null;
        }
        setLast(data);
        setBalance(data.balance);
        return data;
      } catch {
        setError("Network error");
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [bet, gameId],
  );
```

### File 2 of 2 — `src/components/games/VaultGame.tsx` (belt and braces)

**Current** (`:106-114`):

```tsx
        {phase === "idle" && (
          <button type="button" onClick={start} className="btn btn-primary w-full">{t("start")}</button>
        )}
        {dialIndex >= 0 && phase !== "done" && (
          <button type="button" onClick={stop} className="btn btn-primary w-full">{t("stop")}</button>
        )}
        {phase === "done" && (
          <button type="button" onClick={start} className="btn btn-secondary w-full">{t("again")}</button>
        )}
```

**Replacement** — disable the two `start` controls while a round is in flight,
matching every other game:

```tsx
        {phase === "idle" && (
          <button type="button" onClick={start} disabled={busy} className="btn btn-primary w-full">{t("start")}</button>
        )}
        {dialIndex >= 0 && phase !== "done" && (
          <button type="button" onClick={stop} className="btn btn-primary w-full">{t("stop")}</button>
        )}
        {phase === "done" && (
          <button type="button" onClick={start} disabled={busy} className="btn btn-secondary w-full">{t("again")}</button>
        )}
```

### Why this is correct

The report's root cause is that Vault settles the round from a state transition
(`done`) rather than from the settled promise, so "again" is clickable while the
POST is open. The ref guard refuses the re-entry regardless of render timing; the
`disabled={busy}` on the button is the visible half and matches the other twelve
games' convention.

### What it must not break

- Every game that already disables its control by `busy` is unaffected — the
  guard only fires when a second `play()` arrives during an open round.
- The hook's return contract is unchanged; the refused call returns `null`, which
  is the same value the callers already treat as "no round" (`void play(...)`).

### Risk if wrong

If some game legitimately chains two rounds synchronously (none does — grep:
every `play(` call follows a user control), the guard would drop the second. And
`inFlight.current` is cleared in `finally`, so a thrown/aborted request cannot
wedge the game permanently locked.

### Verify afterwards

- `npm run lint` (no new hook warnings) and `npm run build`.
- Throttle the network to "Slow 3G" in devtools, play Vault, and hammer "again"
  the instant the third dial stops: the Network tab must show exactly one
  `POST /api/games/play`; coins move once.

---

## Item 53 — StealPanel shows the hardcoded 100/250 fallback

**Severity: low.** The victim's visitor is told the fallback literal while the
server charges `economy.stealPrice`/`stealMax`.

### File 1 of 2 — `src/app/[locale]/profile/[username]/page.tsx`

**Current** (imports, `:26` region):

```tsx
import { readProgress } from "@/lib/gamification/xp";
```

**Current** (`:66-70`):

```tsx
export default async function ProfilePage({ params }: PageProps) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const ti = await getTranslations("inventory");
```

**Current** (`:682-689`):

```tsx
      {profile && !isOwn && (
        <StealPanel
          victim={profile.username}
          price={profile.steal_price ?? 100}
          maxAmount={profile.steal_max ?? 250}
          enabled={profile.steal_enabled !== false}
        />
      )}
```

**Replacement** — import `getEconomy`, read it, and pass the same fallbacks and
clamps the server applies (`daily.ts:108-112`):

```tsx
import { readProgress } from "@/lib/gamification/xp";
import { getEconomy } from "@/lib/settings";
```

```tsx
export default async function ProfilePage({ params }: PageProps) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const ti = await getTranslations("inventory");
  // The steal panel advertises the price the server will charge; the fallback for
  // a victim who never set their own must be the panel's configured economy, not
  // a hardcoded 100/250 — and the same clamps `attemptSteal` applies.
  const economy = await getEconomy();
```

```tsx
      {profile && !isOwn && (
        <StealPanel
          victim={profile.username}
          price={Math.max(0, profile.steal_price ?? economy.stealPrice)}
          maxAmount={Math.max(10, profile.steal_max ?? economy.stealMax)}
          enabled={profile.steal_enabled !== false}
        />
      )}
```

(`StealPanel.tsx` itself needs no change — it already renders `price`/`maxAmount`
verbatim in the `hint`.)

### Why this is correct

`attemptSteal` computes exactly `price: Math.max(0, victimProfile.steal_price ??
economy.stealPrice)` and `maxAmount: Math.max(10, victimProfile.steal_max ??
economy.stealMax)` (`daily.ts:108-112`). Mirroring those two lines on the server
page makes the hint's claim true whenever the victim set neither value, and also
fixes the cosmetic clamps the report notes (`steal_price = -5` displayed "-5" for
a server cost of 0; `steal_max = 0` displayed 0 for a server cap of 10).

### What it must not break

- `getEconomy` uses the anon server client and falls back to `ECONOMY_DEFAULTS`
  on any failure, so an un-migrated DB still renders 100/250 — now via the same
  source the engine uses.
- The page is already dynamic (the layout awaits `cookies()`), so no `revalidate`
  behaviour changes.

### Risk if wrong

If `getEconomy()` were named/exported differently the build fails loudly. If the
action/detail loads were reordered so `economy` were read after an early
`notFound()`, it would add one avoided query — harmless.

### Verify afterwards

- Set `economy.stealPrice = 500` in the panel and view a profile whose
  `steal_price` is null: the hint reads "Attempt costs 500 BadgesCoins", matching
  `attemptSteal`'s charge.
- `select steal_price, steal_max from profiles where username='<victim>';` → SQL
  NULL; UI shows the configured economy values.

---

## Cross-cutting notes

- **Changelog**: every code change above needs `npm run log:change <kind> "…"
  "…"`; migration 0034 carries its own row. An undocumented change is invisible
  on `/changelog`.
- **Verification ritual** for all code files: `npm run lint && npm run typecheck
  && npm run build` before finishing. Watch the build log for `MISSING_MESSAGE` —
  none of these fixes adds a key, so any such line means a mistake.
- **No new i18n keys** are introduced anywhere in this proposal: item 11 reuses
  the existing (and currently unused) `games.disabled`, item 21 uses
  `notFound()`/404, and the achievement titles/descriptions are hardcoded English
  in `achievements.ts` (persisted unlocks resolve by id), so the item 17 reword
  is a single-line change with no locale work.
- **Suggested publication order** (each independently shippable): 12 → 11 →
  13/14/15/16/17 (achievements batch) → 18 → 19 → 21 → 23 → 52 → 53, with 20's
  migration (0034 + the two `try/catch` edits) as its own commit.