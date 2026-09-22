import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Economy safety proof for the games.
 *
 * Two classes of exploit used to exist:
 *   - the five browser-rendered skill games paid a MULTIPLIER of a
 *     client-reported score, so POSTing a perfect score returned +120%…+200%
 *     per round;
 *   - the scratch table paid 20x on an event that occurred ~12.6% of the time,
 *     and every tower cash-out level was +EV.
 *
 * This script plays every game many times with a *cheating* client (maximum
 * reported score / the most favourable choice) and reports the average return
 * per coin staked. Anything >= 1.0 is still exploitable and fails the run.
 */
async function main() {
  const { resolveGame, GAMES } = await import("@/lib/gamification/games");

  // Minimal stub: the resolvers only touch supabase for hilo's previous round
  // and for the slots symbol pool. Any chain resolves to an empty result, which
  // also exercises the slots fallback pool.
  const EMPTY = { data: null, error: null };
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown) => resolve(EMPTY);
        }
        return () => chain;
      },
    },
  );
  const stub = { from: () => chain } as unknown as Parameters<typeof resolveGame>[4];

  const ROUNDS = 200_000;
  const BET = 100;

  // The most profitable payload a cheater could send per game.
  const CHEAT: Record<string, Record<string, unknown>> = {
    rps: { choice: "rock" },
    slots: {},
    shoot: { hits: 300, shots: 300 },
    memory: { timeMs: 5000, misses: 0 },
    quiz: { total: 10, correct: 10 },
    coinflip: { target: 1, choice: "heads" },
    hilo: { choice: "higher" },
    roulette: { choice: "green" },
    blackjack: { stopAt: 20 },
    vault: { matches: 3 },
    scratch: {},
    tower: { cashoutAt: 1 },
    catcher: { caught: 400, missed: 0 },
  };

  let worst = { game: "", ratio: 0 };
  let failures = 0;

  console.log(
    `${"game".padEnd(11)} ${"rounds".padStart(8)} ${"avg payout/bet".padStart(15)}  verdict`,
  );

  for (const game of GAMES) {
    const input = CHEAT[game.id];
    if (!input) continue;

    let total = 0;
    let wins = 0;
    const sample = Math.min(ROUNDS, game.id === "slots" ? 40_000 : ROUNDS);
    for (let i = 0; i < sample; i += 1) {
      const outcome = await resolveGame("00000000-0000-0000-0000-000000000000", game.id, BET, input, stub);
      total += outcome.payout;
      if (outcome.payout > BET) wins += 1;
    }
    const ratio = total / (sample * BET);
    const ok = ratio < 1;
    if (!ok) failures += 1;
    if (ratio > worst.ratio) worst = { game: game.id, ratio };
    console.log(
      `${game.id.padEnd(11)} ${String(sample).padStart(8)} ${ratio.toFixed(4).padStart(15)}  ` +
        `${ok ? "ok" : "EXPLOITABLE"}  (win rate ${((wins / sample) * 100).toFixed(1)}%)`,
    );
  }

  console.log(
    `\nworst game: ${worst.game} at ${worst.ratio.toFixed(4)} — ` +
      (failures === 0
        ? "no game returns more than the stake on a cheating payload"
        : `${failures} game(s) still exploitable`),
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("simulation failed:", error);
  process.exit(1);
});