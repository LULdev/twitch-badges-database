import type { BadgeStatus } from "./twitch/types";

/**
 * TBRI v2 — Twitch Badge Rarity Index (proprietary).
 *
 * score = 100 × (0.40·scarcity + 0.10·wear + 0.20·obtainability
 *                + 0.10·age + 0.10·momentum + 0.10·brevity)
 *
 *  scarcity       log-scaled inverse of lifetime owner count from potat.app
 *                 (1 owner → 1.0, ~30M owners → 0.0; unknown → 0.35)
 *  wear           share of owners still displaying the badge (active/owners)
 *  obtainability  expired → 1.0, closing <30d → 0.85, limited → 0.7,
 *                 upcoming → 0.6, permanent/active → 0.35
 *  age            time since first detection, saturating at 3 years
 *  momentum       24h active-user growth from the potat time series
 *                 (badge_stats via badge_momentum) — hot claim waves push
 *                 this toward 1.0; unknown history → 0.5 neutral
 *  brevity        length of the claim window (start→end): a 1-day drop is
 *                 maximally brief (1.0), a year-long campaign → 0.0,
 *                 windowless badges → 0.0
 */

export type RarityTier =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

export interface RarityInput {
  totalOwners: number | null;
  activeUsers: number | null;
  status: BadgeStatus;
  startDate: string | null;
  endDate: string | null;
  firstSeenAt: string | null;
  /** Absolute active-user growth over the last ~24h (potat time series). */
  growth24h?: number | null;
  /** Ticket-purchase badges (TwitchCon & co.) are always legendary. */
  requiresTicket?: boolean;
}

export interface RarityResult {
  score: number;
  tier: RarityTier;
}

const OWNERS_MAX = 3.0e7;
const WEIGHTS = {
  scarcity: 0.4,
  wear: 0.1,
  obtainability: 0.2,
  age: 0.1,
  momentum: 0.1,
  brevity: 0.1,
};
const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function scarcityOf(totalOwners: number | null): number {
  if (totalOwners === null || !Number.isFinite(totalOwners)) return 0.35;
  if (totalOwners <= 1) return 1;
  return clamp01(1 - Math.log10(totalOwners) / Math.log10(OWNERS_MAX));
}

function wearOf(totalOwners: number | null, activeUsers: number | null): number {
  if (
    totalOwners === null ||
    activeUsers === null ||
    totalOwners <= 0 ||
    !Number.isFinite(totalOwners) ||
    !Number.isFinite(activeUsers)
  ) {
    return 0.5;
  }
  return clamp01(activeUsers / totalOwners);
}

function obtainabilityOf(input: RarityInput, now: Date): number {
  if (input.status === "removed") return 1;
  if (input.status === "expired") return 1;
  if (input.status === "upcoming") return 0.6;
  if (input.endDate) {
    const daysLeft =
      (new Date(input.endDate).getTime() - now.getTime()) / 86_400_000;
    if (daysLeft <= 30) return 0.85;
    return 0.7;
  }
  return 0.35;
}

function ageOf(firstSeenAt: string | null, now: Date): number {
  if (!firstSeenAt) return 0.2;
  const days =
    (now.getTime() - new Date(firstSeenAt).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0.1;
  return clamp01(days / 1095);
}

function momentumOf(input: RarityInput): number {
  if (input.status === "expired" || input.status === "removed") return 0;
  if (
    input.growth24h === null ||
    input.growth24h === undefined ||
    !Number.isFinite(input.growth24h) ||
    !input.activeUsers ||
    input.activeUsers <= 0
  ) {
    return 0.5; // no history yet — neutral
  }
  // +5% active growth in a day is a hot claim wave → 1.0
  const ratio = input.growth24h / input.activeUsers;
  return clamp01(ratio * 20);
}

function brevityOf(input: RarityInput): number {
  if (!input.startDate || !input.endDate) return 0;
  const days =
    (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) /
    86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return clamp01(1 - Math.log10(Math.max(days, 0.25)) / Math.log10(365));
}

export function computeRarity(
  input: RarityInput,
  now: Date = new Date(),
): RarityResult {
  const raw =
    WEIGHTS.scarcity * scarcityOf(input.totalOwners) +
    WEIGHTS.wear * wearOf(input.totalOwners, input.activeUsers) +
    WEIGHTS.obtainability * obtainabilityOf(input, now) +
    WEIGHTS.age * ageOf(input.firstSeenAt, now) +
    WEIGHTS.momentum * momentumOf(input) +
    WEIGHTS.brevity * brevityOf(input);

  // Ticket-purchase badges (TwitchCon & co.) are pinned to legendary:
  // physical presence plus a paid ticket makes them inherently scarce.
  if (input.requiresTicket) {
    const score = Math.min(87, Math.max(76, Math.round((100 * raw) / WEIGHT_SUM)));
    return { score, tier: "legendary" };
  }

  const score = Math.round((100 * raw) / WEIGHT_SUM);
  return { score, tier: tierOf(score) };
}

export function tierOf(score: number): RarityTier {
  if (score >= 88) return "mythic";
  if (score >= 75) return "legendary";
  if (score >= 60) return "epic";
  if (score >= 40) return "rare";
  if (score >= 20) return "uncommon";
  return "common";
}

export const RARITY_TIERS: RarityTier[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];

export const RARITY_COLORS: Record<RarityTier, string> = {
  common: "#9aa0b0",
  uncommon: "#34d399",
  rare: "#60a5fa",
  epic: "#a970ff",
  legendary: "#fbbf24",
  mythic: "#f87171",
};
