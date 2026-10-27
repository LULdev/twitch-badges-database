/**
 * Badge Rocket — the shared, deterministic crash math.
 *
 * Used by THREE sides that must agree to the digit: the client (it animates
 * the climb from `startedAt` alone), the engine in
 * `src/lib/gamification/crash.ts` (it grades every cash-out from the server
 * clock through the same `crashMultiplierAt`) and the economy harness
 * (`scripts/verify-game-economy.ts`, which simulates strategies against the
 * same distribution). No imports beyond nothing — this module must stay
 * client-safe and side-effect free.
 *
 * Economy: the crash point follows the classic instant-house-edge curve
 * `crash = (1 - edge) / (1 - U)` with U ~ Uniform(0,1), so for any target T
 * the survival odds are P(crash >= T) = (1 - edge) / T and the expected
 * return of cashing out at T is exactly `1 - edge` (96% at the default 4%)
 * — no strategy, honest or forged, moves the RTP, because the cash-out
 * multiplier is computed from the SERVER clock, never claimed by the client.
 * The roll clamps at 1.00x (a ~4% instant pad explosion) and 250.00x.
 */

/** Climb rate: m(t) = e^(K·t). 0.18/s reaches 2x at ~3.9 s, 10x at ~12.8 s. */
export const CRASH_GROWTH_K = 0.18;

/** Hard ceiling for a rolled crash point (x100, i.e. 250.00x). */
export const CRASH_MAX_X100 = 25_000;

/** House edge as a fraction (4% → 96% RTP for every cash-out strategy). */
export const CRASH_EDGE = 0.04;

/**
 * A round is mathematically over after this many ms no matter what was
 * rolled: e^(0.18·45s) ≈ 3,530x dwarfs the 250x cap, so every pending row
 * older than this can be settled by the sweep without reading the clock
 * again. Also the re-attach / one-flight guard horizon.
 */
export const CRASH_TTL_MS = 45_000;

/** The multiplier at `ms` milliseconds into a flight. Monotonic, m(0) = 1. */
export function crashMultiplierAt(ms: number): number {
  return Math.exp((CRASH_GROWTH_K * Math.max(0, ms)) / 1000);
}

/** Milliseconds a flight needs to reach `mult` (inverse of the above). */
export function crashTimeForMs(mult: number): number {
  return (Math.log(Math.max(1, mult)) / CRASH_GROWTH_K) * 1000;
}

/**
 * Roll a fresh crash point as an integer x100 (247 === 2.47x). Integer
 * storage keeps the client display, the engine grade and the harness on the
 * exact same value with no float drift between machines.
 */
export function rollCrashX100(rng: () => number = Math.random): number {
  // Clamp U away from 1: (1-U) in the divisor must never hit 0.
  const u = Math.min(0.999_999, Math.max(0, rng()));
  const raw = ((1 - CRASH_EDGE) / (1 - u)) * 100;
  return Math.max(100, Math.min(CRASH_MAX_X100, Math.round(raw)));
}

/** x100 integer → display multiplier (2.47). */
export function x100ToMult(x100: number): number {
  return Math.round(x100) / 100;
}

/** Display multiplier → x100 integer (clamped to the rollable range). */
export function multToX100(mult: number): number {
  return Math.max(100, Math.min(CRASH_MAX_X100, Math.round(mult * 100)));
}
