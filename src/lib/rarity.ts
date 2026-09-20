import type { BadgeStatus } from "./twitch/types";

/**
 * TBRI — Twitch Badge Rarity Index (proprietary).
 *
 * score = 100 × (0.45·scarcity + 0.15·wear + 0.25·window + 0.10·age) / 0.95
 *
 *  scarcity  log-scaled inverse of lifetime owner count (1 owner → 1.0,
 *            ~30M owners → 0.0; unknown data → 0.35 neutral)
 *  wear      share of owners still displaying the badge (active/owners) —
 *            a badge people proudly keep equipped is worth more
 *  window    obtainability: expired → 1.0, closing <30d → 0.85,
 *            limited → 0.7, upcoming → 0.6, permanent → 0.35
 *  age       time since first detection, saturating at 3 years
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
}

export interface RarityResult {
  score: number;
  tier: RarityTier;
}

const OWNERS_MAX = 3.0e7;
const WEIGHTS = { scarcity: 0.45, wear: 0.15, window: 0.25, age: 0.1 };
const WEIGHT_SUM =
  WEIGHTS.scarcity + WEIGHTS.wear + WEIGHTS.window + WEIGHTS.age;

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

function windowOf(input: RarityInput, now: Date): number {
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

export function computeRarity(
  input: RarityInput,
  now: Date = new Date(),
): RarityResult {
  const raw =
    WEIGHTS.scarcity * scarcityOf(input.totalOwners) +
    WEIGHTS.wear * wearOf(input.totalOwners, input.activeUsers) +
    WEIGHTS.window * windowOf(input, now) +
    WEIGHTS.age * ageOf(input.firstSeenAt, now);

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
