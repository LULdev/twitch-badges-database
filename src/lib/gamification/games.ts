import { createAdminClient } from "@/lib/supabase/admin";
import { award, bumpCoins, getProgress } from "./xp";
import { evaluateAchievements } from "./achievements";

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

export async function playGame(
  userId: string,
  gameId: string,
  bet: number,
  input: PlayInput = {},
): Promise<PlayResult> {
  const meta = GAMES.find((g) => g.id === gameId);
  if (!meta) return fail("Unknown game.");
  bet = Math.floor(bet);
  if (!Number.isFinite(bet) || bet < meta.minBet || bet > meta.maxBet) {
    return fail(`Bet must be between ${meta.minBet} and ${meta.maxBet} coins.`);
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
  const streakFlags = await currentStreakFlags(supabase, userId, gameId);

  const result = { ...outcome.result, ...streakFlags };

  const { error: roundError } = await supabase.from("game_rounds").insert({
    user_id: userId,
    game: gameId,
    bet,
    payout: outcome.payout,
    won: outcome.payout > bet,
    result,
  });
  if (roundError) throw roundError;

  // Counters and balance move through atomic increments. Writing absolute
  // values computed from `progress` (read before the round resolved) lost one
  // of two overlapping rounds — including the coin balance itself.
  await supabase.rpc("bump_counters", {
    p_user_id: userId,
    p_deltas: {
      games_played: 1,
      games_won: outcome.payout > bet ? 1 : 0,
      coins_won: Math.max(0, net),
      coins_lost: Math.max(0, -net),
    },
  });
  if (net !== 0) {
    await bumpCoins(userId, net);
  }

  const awardResult = await award(userId, {
    xp: outcome.payout > bet ? 10 : 2,
    source: `game:${gameId}`,
    countsAsGameXp: true,
    skipAchievements: true,
    feedKind: "game",
    feedTitle: outcome.payout > bet
      ? `won ${net.toLocaleString("en")} coins in ${meta.title ?? gameId}`
      : `played ${gameId} (${net >= 0 ? "+" : ""}${net.toLocaleString("en")} coins)`,
    payload: { game: gameId, bet, payout: outcome.payout },
  });

  await evaluateAchievements(userId).catch(() => undefined);

  return {
    ok: true,
    bet,
    payout: outcome.payout,
    won: outcome.payout > bet,
    balance: awardResult.coins,
    result,
  };
}

function fail(message: string): PlayResult {
  return { ok: false, error: message, bet: 0, payout: 0, won: false, balance: 0, result: {} };
}

async function currentStreakFlags(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  gameId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("game_rounds")
    .select("won")
    .eq("user_id", userId)
    .eq("game", gameId)
    .order("created_at", { ascending: false })
    .limit(5);
  const rounds = (data ?? []) as Array<{ won: boolean }>;
  let streak = 0;
  for (const row of rounds) {
    if (row.won) streak += 1;
    else break;
  }
  if (gameId === "rps" || gameId === "blackjack") {
    return streak >= 4 ? { [`streak5`]: true } : {};
  }
  return {};
}

async function resolveGame(
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
      if (player === bot) return { payout: bet, result: { player, bot, tie: true } };
      const won = beats[player] === bot;
      return { payout: won ? bet * 2 : 0, result: { player, bot, tie: false, won } };
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
      const mult = clamp(accuracy * 2.2 - 0.8, -1, 1.2);
      const net = Math.floor(bet * mult);
      return {
        payout: Math.max(0, bet + net),
        result: { hits, shots, accuracy: Number(accuracy.toFixed(3)), sharp: accuracy >= 0.9 },
      };
    }

    case "memory": {
      const timeMs = clampInt(input.timeMs, 5000, 600000);
      const misses = clampInt(input.misses, 0, 100);
      const mult = clamp(1.6 - timeMs / 90000 - misses * 0.06, -1, 1.2);
      const net = Math.floor(bet * mult);
      return {
        payout: Math.max(0, bet + net),
        result: {
          timeMs, misses,
          perfect: misses === 0,
          fast: timeMs <= 30000,
        },
      };
    }

    case "quiz": {
      const total = clampInt(input.total, 1, 20);
      const correct = clampInt(input.correct, 0, total);
      const ratio = correct / total;
      const mult = clamp(ratio * 2.1 - 0.8, -1, 1.2);
      const net = Math.floor(bet * mult);
      return {
        payout: Math.max(0, bet + net),
        result: { correct, total, streak10: correct === total && total >= 10 },
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
      const currentScore = Number(
        ((last?.result as Record<string, unknown> | null)?.nextScore as number | undefined) ??
          30 + Math.floor(Math.random() * 40),
      );
      const nextScore = 5 + Math.floor(Math.random() * 91);
      const guess = input.choice === "lower" ? "lower" : "higher";
      const actual = nextScore === currentScore ? "equal" : nextScore > currentScore ? "higher" : "lower";
      const won = actual === guess;
      return {
        payout: won ? Math.floor(bet * 1.95) : 0,
        result: { currentScore, nextScore, guess, actual, won, streak10: false },
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
      const matches = clampInt(input.matches, 0, 3);
      const mult = [0, 0.5, 1.5, 3][matches];
      const payout = Math.floor(bet * mult);
      return {
        payout,
        result: { matches, mult, perfect: matches === 3 },
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
      for (const count of counts.values()) {
        if (count >= 3) mult = Math.max(mult, count === 3 ? 2 : 6);
      }
      // Rare jackpot triple: three dedicated jackpot symbols
      const jackpot = (counts.get("jackpot") ?? 0) >= 3;
      if (jackpot) mult = 20;
      return { payout: Math.floor(bet * mult), result: { cells, mult, jackpot } };
    }

    case "tower": {
      const cashoutAt = clampInt(input.cashoutAt ?? 5, 1, 10);
      let floor = 0;
      let survived = true;
      while (floor < cashoutAt) {
        floor += 1;
        const failChance = 0.08 + floor * 0.055;
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
      const mult = clamp(caught * 0.012 - missed * 0.02, -1, 1.5);
      const net = Math.floor(bet * mult);
      return {
        payout: Math.max(0, bet + net),
        result: { caught, missed, hundred: caught >= 100 },
      };
    }

    default:
      return { payout: 0, result: {} };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: unknown, min: number, max: number): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

/** Deterministic symbol pool for slots/quiz/memory (real badge images). */
export interface SlotSymbol {
  id: string;
  label: string;
  image: string | null;
  weight: number;
  value: number;
}

let symbolCache: SlotSymbol[] | null = null;

export async function slotSymbols(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<SlotSymbol[]> {
  if (symbolCache) return symbolCache;
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
  const pool: SlotSymbol[] = rows.map((row, index) => ({
    id: row.slug,
    label: row.title,
    image: row.image_url_2x,
    weight: [30, 24, 20, 16, 12, 8][index] ?? 10,
    value: [1, 1.2, 1.4, 1.6, 2, 2.5][index] ?? 1,
  }));
  pool.push({ id: "scatter", label: "Book of Badges", image: null, weight: 6, value: 1 });
  symbolCache = pool;
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
  const symbols = ["premium", "turbo", "bits", "founder", "subtember", "wsci", "jackpot"];
  return symbols[Math.floor(Math.random() * symbols.length)];
}
