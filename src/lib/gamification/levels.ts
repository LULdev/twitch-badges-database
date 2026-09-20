/**
 * Level system: 1–100.
 * XP required to advance from level L to L+1: 100 + (L-1)·50
 * → total XP for level 100: 254 900.
 */

export interface LevelInfo {
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number; // 0..1
}

export function xpToAdvance(level: number): number {
  return 100 + (Math.max(1, Math.min(100, level)) - 1) * 50;
}

export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l += 1) total += xpToAdvance(l);
  return total;
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  while (level < 100 && remaining >= xpToAdvance(level)) {
    remaining -= xpToAdvance(level);
    level += 1;
  }
  const xpForNext = level >= 100 ? 0 : xpToAdvance(level);
  return {
    level,
    totalXp: Math.max(0, Math.floor(xp)),
    xpIntoLevel: remaining,
    xpForNext,
    progress: xpForNext > 0 ? remaining / xpForNext : 1,
  };
}

/** Visual theme of the per-level badge (always visible, cannot be hidden). */
export interface LevelTheme {
  gradient: string;
  glow: string;
  halo: string;
  label: string;
}

const BRACKETS: Array<{ max: number; theme: LevelTheme }> = [
  { max: 10, theme: { gradient: "linear-gradient(135deg,#9aa0b0,#6b7280)", glow: "#9aa0b0", halo: "rgba(154,160,176,.45)", label: "Stone" } },
  { max: 20, theme: { gradient: "linear-gradient(135deg,#34d399,#059669)", glow: "#34d399", halo: "rgba(52,211,153,.45)", label: "Emerald" } },
  { max: 30, theme: { gradient: "linear-gradient(135deg,#60a5fa,#2563eb)", glow: "#60a5fa", halo: "rgba(96,165,250,.45)", label: "Sapphire" } },
  { max: 40, theme: { gradient: "linear-gradient(135deg,#a970ff,#7c3aed)", glow: "#a970ff", halo: "rgba(169,112,255,.45)", label: "Amethyst" } },
  { max: 55, theme: { gradient: "linear-gradient(135deg,#f472b6,#db2777)", glow: "#f472b6", halo: "rgba(244,114,182,.45)", label: "Rose" } },
  { max: 70, theme: { gradient: "linear-gradient(135deg,#fb923c,#ea580c)", glow: "#fb923c", halo: "rgba(251,146,60,.45)", label: "Amber" } },
  { max: 85, theme: { gradient: "linear-gradient(135deg,#fbbf24,#d97706)", glow: "#fbbf24", halo: "rgba(251,191,36,.5)", label: "Gold" } },
  { max: 99, theme: { gradient: "linear-gradient(135deg,#f87171,#dc2626)", glow: "#f87171", halo: "rgba(248,113,113,.5)", label: "Inferno" } },
  { max: 100, theme: { gradient: "conic-gradient(from 0deg,#f87171,#fbbf24,#a970ff,#60a5fa,#34d399,#f87171)", glow: "#a970ff", halo: "rgba(169,112,255,.6)", label: "Mythic" } },
];

export function levelTheme(level: number): LevelTheme {
  for (const bracket of BRACKETS) {
    if (level <= bracket.max) return bracket.theme;
  }
  return BRACKETS[BRACKETS.length - 1].theme;
}
