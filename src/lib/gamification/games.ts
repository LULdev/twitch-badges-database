import { createAdminClient } from "@/lib/supabase/admin";
import { award, bumpCoins, getProgress } from "./xp";
import { evaluateAchievements } from "./achievements";
import { getEconomy, getFeatures, getGames } from "@/lib/settings";

/**
 * The arcade: 13 badge-themed games, all server-authoritative.
 * Luck games roll on the server; skill games accept a score report with
 * sanity caps. Every round lands in game_rounds and the live feed.
 */

export interface GameMeta {
  id: string;
  title: string;
  type: "luck" | "skill";
  minBet: number;
  maxBet: number;
}

export const GAMES: GameMeta[] = [
  { id: "rps", title: "Rock-Paper-Scissors", type: "luck", minBet: 10, maxBet: 5000 },
  { id: "slots", title: "Badges of Ra 6 Deluxe", type: "luck", minBet: 10, maxBet: 2000 },
  { id: "shoot", title: "Shoot the Badges", type: "skill", minBet: 10, maxBet: 2000 },
  { id: "memory", title: "Badge Memory", type: "skill", minBet: 10, maxBet: 2000 },
  { id: "quiz", title: "Badge Quiz", type: "skill", minBet: 10, maxBet: 2000 },
  { id: "coinflip", title: "Coin Flip Ladder", type: "luck", minBet: 10, maxBet: 5000 },
  { id: "hilo", title: "Higher or Lower", type: "luck", minBet: 10, maxBet: 5000 },
  { id: "roulette", title: "Badge Roulette", type: "luck", minBet: 10, maxBet: 5000 },
  { id: "blackjack", title: "Badge Blackjack", type: "luck", minBet: 10, maxBet: 5000 },
  { id: "vault", title: "Crack the Vault", type: "skill", minBet: 10, maxBet: 2000 },
  { id: "scratch", title: "Scratch the Badge", type: "luck", minBet: 10, maxBet: 1000 },
  { id: "tower", title: "Tower of Badges", type: "luck", minBet: 10, maxBet: 2000 },
  { id: "catcher", title: "Drops Catcher", type: "skill", minBet: 10, maxBet: 2000 },
];

export const GAME_IDS = GAMES.map((g) => g.id);

export interface PlayInput {
  choice?: string;
  hits?: number;
  shots?: number;
  caught?: number;
  missed?: number;
  timeMs?: number;
  misses?: number;
  correct?: number;
  total?: number;
  matches?: number;
  cashoutAt?: number;
  target?: number;
  stopAt?: number;
}

export interface PlayResult {
  ok: boolean;
  error?: string;
  bet: number;
  payout: number;
  won: boolean;
  balance: number;
  result: Record<string, unknown>;
}

const RATE_LIMIT_MS = 1000;

/**
 * Threshold for the post-insert race recheck. It is compared between two
 * timestamps written by the DATABASE, while the pre-check above compares
 * app-clock times — the 100 ms slack keeps a legitimate 1 Hz player (whose gap
 * is >= 1000 ms by the app clock) from being voided by clock skew, while a
 * parallel burst (a ~0 ms gap) is still caught.
 */
const RATE_RACE_MS = RATE_LIMIT_MS - 100;

export async function playGame(
  userId: string,
  gameId: string,
  bet: number,
  input: PlayInput = {},
): Promise<PlayResult> {
  const meta = GAMES.find((g) => g.id === gameId);
  if (!meta) return fail("Unknown game.");
  // All three arcade switches are enforced HERE, not only in the pages. The master
  // switch and the `features.games` flag were honoured by the hub and the API route
  // while this engine settled rounds regardless, so an arcade "switched off" stayed
  // fully playable from the game URL. The panel can also switch a single game off or
  // move its bet bounds; the catalog metadata is only the fallback, so a settings
  // document written before a game existed can never make that game unplayable.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);
  if (!settings.enabled || !features.games) {
    return fail("The arcade is currently switched off.");
  }
  const rules =
    settings.games[meta.id] ?? { enabled: true, minBet: meta.minBet, maxBet: meta.maxBet };
  if (!rules.enabled) return fail("This game is currently switched off.");
  bet = Math.floor(bet);
  if (!Number.isFinite(bet) || bet < rules.minBet || bet > rules.maxBet) {
    return fail(`Bet must be between ${rules.minBet} and ${rules.maxBet} coins.`);
  }

  const supabase = createAdminClient();

  // Flood check: max one round per second.
  const { data: lastRound } = await supabase
    .from("game_rounds")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    lastRound &&
    Date.now() - new Date(String(lastRound.created_at)).getTime() < RATE_LIMIT_MS
  ) {
    return fail("Slow down — one round per second.");
  }

  const progress = await getProgress(userId);
  if (progress.coins < bet) return fail("Not enough coins.");

  const outcome = await resolveGame(userId, gameId, bet, input, supabase);

  const net = outcome.payout - bet;
  // ONE grading decision, used everywhere below. A resolver that reports its own
  // `won` knows better than the payout does: hilo pays by the odds, so a correct
  // call at the edges returns slightly less than the stake (0.981x worst) while still
  // being a win. Previously only the streak flag honoured that — the persisted
  // row, the `games_won` counter, the win XP, the feed line and the response all
  // graded on `payout > bet`, so such a round was still recorded as a loss.
  const won = typeof outcome.result.won === "boolean" ? outcome.result.won : outcome.payout > bet;
  const streakFlags = await currentStreakFlags(supabase, userId, gameId, won);

  const result = { ...outcome.result, ...streakFlags };

  const { data: round, error: roundError } = await supabase
    .from("game_rounds")
    .insert({
      user_id: userId,
      game: gameId,
      bet,
      payout: outcome.payout,
      won,
      result,
    })
    .select("id")
    .maybeSingle();
  if (roundError) throw roundError;

  // The 1/s flood check above reads the newest existing round and this insert
  // happens after it, so two requests fired in parallel both passed. Re-reading
  // the two newest rows now that ours is in closes that hole: a burst leaves a
  // ~0 ms gap between them, so EVERY racer voids its own round — conservative
  // on purpose, and harmless because nothing has moved yet (counters, coins and
  // XP all come later); the user simply retries. A truly atomic guard needs a
  // unique index on (user_id, epoch second), which is not in the schema.
  const { data: newest } = await supabase
    .from("game_rounds")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(2);
  if (
    newest &&
    newest.length === 2 &&
    new Date(String(newest[0].created_at)).getTime() -
      new Date(String(newest[1].created_at)).getTime() <
      RATE_RACE_MS
  ) {
    if (round?.id != null) {
      // The cleanup must not fail silently: a surviving row would count for
      // streaks, maxBet and the feed without ever being settled.
      const { error: voidError } = await supabase
        .from("game_rounds")
        .delete()
        .eq("id", round.id);
      if (voidError) {
        console.warn("[game] could not void the raced round:", voidError.message);
      }
    }
    return fail("Slow down — one round per second.");
  }

  // Counters and balance move through atomic increments. Writing absolute
  // values computed from `progress` (read before the round resolved) lost one
  // of two overlapping rounds — including the coin balance itself. Their errors
  // are thrown: a failed counter used to leave games_played/coins_won behind
  // while the balance and the round had already moved.
  const { error: counterError } = await supabase.rpc("bump_counters", {
    p_user_id: userId,
    p_deltas: {
      games_played: 1,
      games_won: won ? 1 : 0,
      coins_won: Math.max(0, net),
      coins_lost: Math.max(0, -net),
    },
  });
  if (counterError) throw counterError;
  if (net !== 0) {
    await bumpCoins(userId, net);
  }

  const economy = await getEconomy();
  const awardResult = await award(userId, {
    xp: won ? economy.gameWinXp : economy.gameLoseXp,
    source: `game:${gameId}`,
    countsAsGameXp: true,
    skipAchievements: true,
    feedKind: "game",
    // `won` now comes from the resolver, and hilo's odds-priced edges pay slightly
    // LESS than the stake on a correct call — so "won N coins" must not print a
    // negative N. A correct call that nets nothing reads as the call it was.
    feedTitle: won
      ? net > 0
        ? `won ${net.toLocaleString("en")} coins in ${meta.title ?? gameId}`
        : `called it right in ${meta.title ?? gameId} (${net.toLocaleString("en")} coins)`
      : `played ${gameId} (${net >= 0 ? "+" : ""}${net.toLocaleString("en")} coins)`,
    payload: { game: gameId, bet, payout: outcome.payout },
  });

  await evaluateAchievements(userId).catch(() => undefined);

  return {
    ok: true,
    bet,
    payout: outcome.payout,
    won,
    balance: awardResult.coins,
    result,
  };
}

function fail(message: string): PlayResult {
  return { ok: false, error: message, bet: 0, payout: 0, won: false, balance: 0, result: {} };
}

/**
 * Streak achievements. This runs BEFORE the current round is inserted, so the
 * round being played is passed in explicitly — otherwise a loss could still
 * complete the streak, and the win that actually completed it was not counted.
 */
async function currentStreakFlags(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  gameId: string,
  currentWon: boolean,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("game_rounds")
    .select("won")
    .eq("user_id", userId)
    .eq("game", gameId)
    .order("created_at", { ascending: false })
    .limit(10);
  const rounds = (data ?? []) as Array<{ won: boolean }>;
  let streak = 0;
  for (const row of rounds) {
    if (row.won) streak += 1;
    else break;
  }
  if (!currentWon) return {};
  const total = streak + 1;

  if ((gameId === "rps" || gameId === "blackjack") && total >= 5) {
    return { streak5: true };
  }
  // k_hilo_10 "Predict 10 higher/lower rounds in a row" was unreachable before:
  // the resolver hardcoded streak10:false and this branch did not exist.
  if (gameId === "hilo" && total >= 10) {
    return { streak10: true };
  }
  return {};
}

export async function resolveGame(
  userId: string,
  gameId: string,
  bet: number,
  input: PlayInput,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ payout: number; result: Record<string, unknown> }> {
  switch (gameId) {
    case "rps": {
      const choices = ["rock", "paper", "scissors"];
      const player = choices.includes(String(input.choice)) ? String(input.choice) : "rock";
      const bot = choices[Math.floor(Math.random() * 3)];
      const beats: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };
      // A refunded tie plus a 2x win makes the expected value exactly 1.0 —
      // break-even, which a bot can grind indefinitely. 1.9x keeps the game
      // fair-feeling with a small house edge, like coinflip.
      if (player === bot) return { payout: bet, result: { player, bot, tie: true } };
      const won = beats[player] === bot;
      return { payout: won ? Math.floor(bet * 1.9) : 0, result: { player, bot, tie: false, won } };
    }

    case "slots": {
      const symbols = await slotSymbols(supabase);
      const reels: string[][] = [];
      for (let r = 0; r < 3; r += 1) {
        reels.push(Array.from({ length: 5 }, () => weightedSymbol(symbols)));
      }
      const lines = [
        [0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2],
        [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
      ];
      const lineWins: Array<{ line: number; symbol: string; count: number; amount: number }> = [];
      let payout = 0;
      lines.forEach((line, lineIndex) => {
        const first = reels[line[0]][0];
        let count = 1;
        while (count < 5 && reels[line[count]][count] === first) count += 1;
        if (count >= 3) {
          const symbol = symbols.find((s) => s.id === first);
          const mult = count === 3 ? 1.5 : count === 4 ? 4 : 15;
          const amount = Math.floor((bet / 5) * mult * (symbol?.value ?? 1));
          payout += amount;
          lineWins.push({ line: lineIndex, symbol: first, count, amount });
        }
      });
      let scatter = 0;
      for (let col = 0; col < 5; col += 1) {
        if (reels.some((row) => row[col] === "scatter")) scatter += 1;
      }
      if (scatter >= 3) payout += bet * (scatter === 3 ? 2 : scatter === 4 ? 5 : 20);
      const jackpot = payout >= 5000;
      return {
        payout: Math.min(payout, bet * 25),
        result: { reels, lineWins, scatter, jackpot, scatterHit: scatter >= 3 },
      };
    }

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
          sharp: outcome.won && accuracy >= 0.9,
        },
      };
    }

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
          perfect: outcome.won && misses === 0,
          fast: outcome.won && timeMs <= 30000,
        },
      };
    }

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
          streak10: outcome.won && correct === total && total >= 10,
        },
      };
    }

    case "coinflip": {
      const target = clampInt(input.target ?? 1, 1, 7);
      const side = input.choice === "tails" ? "tails" : "heads";
      const flips: string[] = [];
      let survived = true;
      for (let i = 0; i < target; i += 1) {
        const flip = Math.random() < 0.5 ? "heads" : "tails";
        flips.push(flip);
        if (flip !== side) {
          survived = false;
          break;
        }
      }
      const payout = survived ? Math.floor(bet * Math.pow(2, target) * 0.97) : 0;
      return { payout, result: { side, flips, survived, ladder7: survived && target >= 7 } };
    }

    case "hilo": {
      const { data: last } = await supabase
        .from("game_rounds")
        .select("result")
        .eq("user_id", userId)
        .eq("game", "hilo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const currentScore = Math.min(
        94,
        Math.max(
          6,
          Number(
            ((last?.result as Record<string, unknown> | null)?.nextScore as number | undefined) ??
              30 + Math.floor(Math.random() * 40),
          ),
        ),
      );
      // Drawn 6..94 so BOTH sides always have at least one winning value: the
      // value the player is shown is then exactly the value the next round is
      // judged against, and the impossible-side refund below is unreachable
      // rather than a silent dead branch. (The clamp on `currentScore` above
      // still guards scores stored before this change.)
      const nextScore = 6 + Math.floor(Math.random() * 89);
      const guess = input.choice === "lower" ? "lower" : "higher";
      const tie = nextScore === currentScore;
      const actual = tie ? "equal" : nextScore > currentScore ? "higher" : "lower";
      // A tie used to be neither "higher" nor "lower", so it silently counted
      // as a full loss with no explanation. It now refunds the stake.
      const won = !tie && actual === guess;

      // The player can SEE `currentScore` — the client renders it and carries it
      // from the previous round — so the guess is informed, and a flat payout is
      // beatable: picking the likelier side won 90 of the 91 values (0.989),
      // which against 1.95x was ~1.93x EV per bet. The committed economy harness
      // never caught it because it always sends `choice: "higher"` (a blind coin
      // flip). Pay by the odds instead, so the payout matches the probability the
      // player is shown; the cap keeps the multiplier finite. The EV bound is
      // min(20p, 0.97) + 1/89 — the tie refunds, so it ADDS rather than vanishing
      // — giving a worst case of 0.9812 < 1. (An earlier version of this comment
      // said 0.97 and ignored the refund.)
      // The spread must be the range actually DRAWN (6..94, 89 values), not the
      // 5..95 the draw used before the clamp: with the stale range the odds were
      // mispriced and the impossible-side guard below could never fire, because
      // (95-cs)/91 and (cs-5)/91 are always ≥ 1/91 — so `currentScore = 6` with
      // "lower" was accepted as if it had a 1/91 chance when it has NO winning
      // value at all.
      const spread = 89;
      const winChance =
        guess === "higher" ? (94 - currentScore) / spread : (currentScore - 6) / spread;
      if (winChance <= 0) {
        // The score sits at the edge, so the chosen side has no winning value at
        // all. Refund rather than take a stake that cannot win.
        return {
          payout: bet,
          result: {
            currentScore,
            nextScore,
            guess,
            actual,
            won: false,
            tie: false,
            impossible: true,
          },
        };
      }
      const multiplier = Math.min(20, 0.97 / winChance);
      return {
        payout: won ? Math.max(1, Math.floor(bet * multiplier)) : tie ? bet : 0,
        result: { currentScore, nextScore, guess, actual, won, tie },
      };
    }

    case "roulette": {
      const number = Math.floor(Math.random() * 37); // 0 = green
      const color = number === 0 ? "green" : number % 2 === 0 ? "red" : "black";
      const betColor = ["red", "black", "green"].includes(String(input.choice))
        ? String(input.choice)
        : "red";
      const won = betColor === color;
      const payout = won ? (color === "green" ? bet * 14 : bet * 2) : 0;
      return { payout, result: { number, color, betColor, won, green: color === "green" } };
    }

    case "blackjack": {
      const stopAt = clampInt(input.stopAt ?? 17, 12, 20);
      const card = () => 1 + Math.floor(Math.random() * 11);
      const playerCards: number[] = [card(), card()];
      while (playerCards.reduce((a, b) => a + b, 0) < stopAt) playerCards.push(card());
      const playerTotal = playerCards.reduce((a, b) => a + b, 0);
      const dealerCards: number[] = [card(), card()];
      while (dealerCards.reduce((a, b) => a + b, 0) < 17) dealerCards.push(card());
      const dealerTotal = dealerCards.reduce((a, b) => a + b, 0);
      let outcome: "win" | "lose" | "push";
      if (playerTotal > 21) outcome = "lose";
      else if (dealerTotal > 21 || playerTotal > dealerTotal) outcome = "win";
      else if (playerTotal === dealerTotal) outcome = "push";
      else outcome = "lose";
      const payout =
        outcome === "win"
          ? playerCards.length === 2 && playerTotal === 21
            ? Math.floor(bet * 2.5)
            : bet * 2
          : outcome === "push"
            ? bet
            : 0;
      return { payout, result: { playerCards, dealerCards, playerTotal, dealerTotal, stopAt, outcome } };
    }

    case "vault": {
      // The pin positions are rendered in the browser, so `matches` is a client
      // claim. It now sets the win chance instead of the payout multiplier:
      // 0.45 x 2x = 0.90 at a forged perfect run.
      const matches = clampInt(input.matches, 0, 3);
      const chance = [0.05, 0.15, 0.29, 0.45][matches];
      const won = Math.random() < chance;
      return {
        payout: won ? bet * 2 : 0,
        // `perfect` means all three needles landed AND the vault actually opened:
        // the achievement reads it, and `matches` is a client claim, so gating on
        // `won` keeps a forged `matches: 3` from banking it on a loss.
        result: { matches, chance, won, perfect: won && matches === 3 },
      };
    }

    case "scratch": {
      const cells: string[] = [];
      for (let i = 0; i < 9; i += 1) {
        cells.push(scratchSymbol());
      }
      const counts = new Map<string, number>();
      cells.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
      let mult = 0;
      for (const [symbol, count] of counts) {
        if (count >= 3) {
          // 3 / 4 / 5+ of a kind — tuned so the total EV stays below 1.
          const base = count === 3 ? 0.7 : count === 4 ? 2 : 5;
          mult = Math.max(mult, symbol === "jackpot" ? Math.min(20, base * 2) : base);
        }
      }
      // The achievement used to say "20x", but the jackpot branch caps at
      // `min(20, base * 2)` with base in {0.7, 2, 5}, so the largest jackpot win is
      // 10x and 20x was unreachable. Key the flag on the payout actually won, so it
      // fires on a real 10x instead of on a common 1.4x three-of-a-kind.
      const jackpot = mult >= 10;
      return { payout: Math.floor(bet * mult), result: { cells, mult, jackpot } };
    }

    case "tower": {
      const cashoutAt = clampInt(input.cashoutAt ?? 5, 1, 10);
      let floor = 0;
      let survived = true;
      while (floor < cashoutAt) {
        floor += 1;
        const failChance = 0.20 + floor * 0.06;
        if (Math.random() < failChance) {
          survived = false;
          break;
        }
      }
      const payout = survived ? Math.floor(bet * (1 + cashoutAt * 0.22)) : 0;
      return { payout, result: { cashoutAt, floor, survived, top: survived && cashoutAt >= 10 } };
    }

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
          hundred: outcome.won && caught >= 100,
        },
      };
    }

    default:
      return { payout: 0, result: {} };
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

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
 * The achievement flags these games emit (`sharp`, `perfect`, `fast`, `streak10`,
 * `hundred`) are gated on `outcome.won` for the same reason: a flag must not be a
 * second payout path. A forged score used to write the flag on a LOSING round, so
 * one 10-coin POST unlocked the achievement outright.
 */
function skillPayout(bet: number, ratio: number, floorChance: number) {
  const chance = Math.min(0.45, floorChance + Math.max(0, Math.min(1, ratio)) * 0.35);
  const won = Math.random() < chance;
  return { payout: won ? bet * 2 : 0, chance, won };
}

/**
 * Weighted scratch symbol: the jackpot symbol is deliberately rare. With a
 * uniform 1-in-7 pool the "three jackpot symbols" event landed ~12.6 % of the
 * time, so the 20x jackpot alone paid 2.5x the stake on average.
 */
const SCRATCH_SYMBOLS: Array<{ id: string; weight: number }> = [
  { id: "premium", weight: 16 },
  { id: "turbo", weight: 16 },
  { id: "bits", weight: 16 },
  { id: "founder", weight: 16 },
  { id: "subtember", weight: 15 },
  { id: "wsci", weight: 15 },
  { id: "jackpot", weight: 6 },
];

/** Deterministic symbol pool for slots/quiz/memory (real badge images). */
export interface SlotSymbol {
  id: string;
  label: string;
  image: string | null;
  weight: number;
  value: number;
}

let symbolCache: { pool: SlotSymbol[]; at: number } | null = null;
/** A short-lived cache: a bad read must not poison the pool for the instance's
 *  whole lifetime, which is how a single degraded query could serve one payout
 *  to every user of that instance. */
const SYMBOL_CACHE_MS = 10 * 60_000;

export async function slotSymbols(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<SlotSymbol[]> {
  if (symbolCache && Date.now() - symbolCache.at < SYMBOL_CACHE_MS) {
    return symbolCache.pool;
  }
  const preferred = [
    "premium-v1", "turbo-v1", "bits-v1", "founder-v1",
    "subtember-2026-v1", "wsci-2026-v1",
  ];
  const { data } = await supabase
    .from("badges")
    .select("slug,title,image_url_2x")
    .in("slug", preferred)
    .limit(6);
  const rows = (data ?? []) as Array<{ slug: string; title: string; image_url_2x: string | null }>;
  // The weight/value tables below are indexed, so the row order decides which
  // symbol gets which rarity — and a query with no ORDER BY returns rows in an
  // arbitrary order that changes after a heap rewrite. Sort into the intended
  // `preferred` ranking instead of trusting the response order.
  const rank = new Map(preferred.map((slug, i) => [slug, i]));
  rows.sort((a, b) => (rank.get(a.slug) ?? 99) - (rank.get(b.slug) ?? 99));
  const pool: SlotSymbol[] = rows.map((row, index) => ({
    id: row.slug,
    label: row.title,
    image: row.image_url_2x,
    weight: [30, 24, 20, 16, 12, 8][index] ?? 10,
    value: [1, 1.2, 1.4, 1.6, 2, 2.5][index] ?? 1,
  }));
  // A failed DB lookup used to leave the pool holding only the scatter, so every
  // reel showed the scatter and the 25x cap was won on every spin. The guard has
  // to require the COMPLETE pool, not merely two rows: with exactly two symbols
  // the indexed weights (30/24) plus the scatter's 6 concentrate the reels to
  // P≈0.5/0.4/0.1, which pays ~1.356x per spin — a silent coin pump, since a spin
  // takes no player input at all. Any short pool uses the fallback instead.
  if (pool.length < preferred.length) {
    const fallback: Array<{ id: string; label: string; value: number }> = [
      { id: "premium", label: "Premium Badge", value: 1 },
      { id: "turbo", label: "Turbo Badge", value: 1.2 },
      { id: "bits", label: "Bits Badge", value: 1.4 },
      { id: "founder", label: "Founder Badge", value: 1.6 },
      { id: "subtember", label: "Subtember Badge", value: 2 },
      { id: "wsci", label: "WSCI Badge", value: 2.5 },
    ];
    pool.length = 0;
    for (const entry of fallback) {
      pool.push({ ...entry, image: null, weight: 20 });
    }
  }
  pool.push({ id: "scatter", label: "Book of Badges", image: null, weight: 6, value: 1 });
  symbolCache = { pool, at: Date.now() };
  return pool;
}

function weightedSymbol(symbols: SlotSymbol[]): string {
  const total = symbols.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * total;
  for (const s of symbols) {
    roll -= s.weight;
    if (roll <= 0) return s.id;
  }
  return symbols[0].id;
}

function scratchSymbol(): string {
  const total = SCRATCH_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * total;
  for (const symbol of SCRATCH_SYMBOLS) {
    roll -= symbol.weight;
    if (roll <= 0) return symbol.id;
  }
  return SCRATCH_SYMBOLS[0].id;
}
