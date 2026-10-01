import type { ReactNode } from "react";

/**
 * Per-game cover artwork for the games hub. One crafted SVG per registry id,
 * echoing each game's real table look (slot cabinet, roulette rim, vault
 * dial, tower floors…). Purely decorative: the tile's link text carries the
 * meaning, so the svg is aria-hidden. Structure lines are `currentColor` —
 * the tile injects the per-game hue via `--gg-color` (same pattern as
 * `--tier-color` on the badge gallery). Geometry is direction-neutral so it
 * needs no RTL mirroring, and no text is baked in.
 */

/** Decorative per-game hue (rarity/status palette spread). Dark-wash only —
 *  these are color-mixed at 10–45% by the CSS, never used as text color. */
export const GAME_COLORS: Record<string, string> = {
  rps: "#60a5fa",
  slots: "#fbbf24",
  shoot: "#f87171",
  memory: "#34d399",
  quiz: "#a970ff",
  coinflip: "#f59e0b",
  hilo: "#38bdf8",
  roulette: "#fb7185",
  blackjack: "#e879f9",
  vault: "#22d3ee",
  scratch: "#fb923c",
  tower: "#818cf8",
  catcher: "#a3e635",
};

const ART: Record<string, ReactNode> = {
  /* rock · paper · scissors — three glyphs in a row */
  rps: (
    <>
      <circle cx="26" cy="47" r="13" />
      <path d="M26 40v7l5 4" opacity="0.55" />
      <path d="M52 33 74 52M74 33 52 52" />
      <circle cx="49" cy="58" r="4" opacity="0.55" />
      <circle cx="77" cy="58" r="4" opacity="0.55" />
      <rect x="78" y="27" width="28" height="34" rx="3" />
      <path d="M84 37h16M84 45h16M84 53h10" opacity="0.55" />
    </>
  ),
  /* slot cabinet — 3 reels, lever, payout slot */
  slots: (
    <>
      <rect x="18" y="16" width="72" height="56" rx="6" />
      <rect x="26" y="26" width="17" height="22" rx="2" opacity="0.5" />
      <rect x="47" y="26" width="17" height="22" rx="2" opacity="0.5" />
      <rect x="68" y="26" width="17" height="22" rx="2" opacity="0.5" />
      <path d="M34.5 32l3.5 5-3.5 5-3.5-5zM55.5 32l3.5 5-3.5 5-3.5-5zM76.5 32l3.5 5-3.5 5-3.5-5z" fill="currentColor" stroke="none" />
      <path d="M98 46V32" />
      <circle cx="98" cy="28" r="4" />
      <rect x="36" y="58" width="36" height="5" rx="2.5" opacity="0.55" />
    </>
  ),
  /* crosshair with badge diamond */
  shoot: (
    <>
      <circle cx="60" cy="45" r="26" />
      <circle cx="60" cy="45" r="14" opacity="0.5" />
      <path d="M60 13v8M60 69v8M28 45h8M84 45h8" />
      <path d="M60 38l6 7-6 7-6-7z" fill="currentColor" stroke="none" />
      <path d="M31 24l7 7M89 24l-7 7" opacity="0.45" />
    </>
  ),
  /* memory — back card + flipped card with sparkle */
  memory: (
    <>
      <rect x="26" y="22" width="34" height="46" rx="4" opacity="0.45" />
      <path d="M33 30h6M43 30h6M33 40h6M43 40h6M33 50h6M43 50h6" opacity="0.55" />
      <rect x="56" y="26" width="34" height="46" rx="4" />
      <path d="M73 38l3.5 8 8 3.5-8 3.5-3.5 8-3.5-8-8-3.5 8-3.5z" fill="currentColor" stroke="none" opacity="0.9" />
    </>
  ),
  /* quiz — badge diamond under a magnifier */
  quiz: (
    <>
      <path d="M46 18 66 38 46 58 26 38z" />
      <path d="M46 27 55 38 46 49 37 38z" opacity="0.5" />
      <circle cx="79" cy="53" r="12" />
      <path d="M88 62l9 9" />
    </>
  ),
  /* coin flip over rising ladder steps */
  coinflip: (
    <>
      <rect x="20" y="64" width="13" height="8" rx="2" opacity="0.45" />
      <rect x="37" y="56" width="13" height="16" rx="2" opacity="0.6" />
      <rect x="54" y="48" width="13" height="24" rx="2" opacity="0.75" />
      <circle cx="83" cy="36" r="17" />
      <circle cx="83" cy="36" r="11.5" opacity="0.5" />
      <path d="M83 29l2.5 5.5L91 37l-5.5 2.5L83 45l-2.5-5.5L75 37l5.5-2.5z" fill="currentColor" stroke="none" />
    </>
  ),
  /* higher/lower — gauge with diamond marker and both chevrons */
  hilo: (
    <>
      <path d="M24 45h72" opacity="0.35" />
      <path d="M24 45h36" strokeWidth="5" />
      <path d="M60 39l6 6-6 6-6-6z" fill="currentColor" stroke="none" />
      <path d="M54 27l6-6 6 6" />
      <path d="M54 63l6 6 6-6" opacity="0.5" />
      <path d="M24 45v-4M96 45v-4" opacity="0.45" />
    </>
  ),
  /* roulette — rim, spokes, hub, ball */
  roulette: (
    <>
      <circle cx="60" cy="45" r="28" />
      <circle cx="60" cy="45" r="20" opacity="0.45" />
      <path d="M60 17v56M32 45h56M40 25l40 40M80 25 40 65" opacity="0.55" />
      <circle cx="60" cy="45" r="8" fill="currentColor" stroke="none" opacity="0.85" />
      <circle cx="76" cy="29" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  /* blackjack — tilted pair of cards + chip */
  blackjack: (
    <>
      <rect x="24" y="20" width="29" height="41" rx="4" transform="rotate(-8 38.5 40.5)" opacity="0.5" />
      <path d="M31 28l16 24M43 26l-16 24" opacity="0.4" />
      <rect x="52" y="25" width="29" height="41" rx="4" transform="rotate(6 66.5 45.5)" />
      <path d="M66.5 36l5 6-5 6-5-6z" fill="currentColor" stroke="none" />
      <circle cx="98" cy="70" r="8" />
      <circle cx="98" cy="70" r="4" opacity="0.55" />
    </>
  ),
  /* vault — dial, green zone arc, needle */
  vault: (
    <>
      <circle cx="58" cy="45" r="27" />
      <path d="M78 31a24 24 0 0 1 0 28" stroke="var(--success)" strokeWidth="5" opacity="0.85" />
      <path d="M58 22v-5M58 68v5M35 45h-5M81 45h5" opacity="0.5" />
      <path d="M58 45 76 36" strokeWidth="4" />
      <circle cx="58" cy="45" r="4.5" fill="currentColor" stroke="none" />
      <path d="M97 32v26M92 36l10 5" opacity="0.5" />
    </>
  ),
  /* scratch — 3×3 field with the winning star cell */
  scratch: (
    <>
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((col) => {
          const x = 30 + col * 22;
          const y = 13 + row * 22;
          const center = row === 1 && col === 1;
          return center ? (
            <g key="cell-c">
              <rect x={x} y={y} width="17" height="17" rx="3" fill="currentColor" stroke="none" opacity="0.18" />
              <rect x={x} y={y} width="17" height="17" rx="3" />
              <path d="M38.5 18l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z" fill="currentColor" stroke="none" />
            </g>
          ) : (
            <g key={`cell-${row}-${col}`}>
              <rect x={x} y={y} width="17" height="17" rx="3" opacity="0.55" />
              <circle cx={x + 8.5} cy={y + 8.5} r="1.6" fill="currentColor" stroke="none" opacity="0.6" />
            </g>
          );
        }),
      )}
    </>
  ),
  /* tower — five narrowing floors, star on top */
  tower: (
    <>
      <rect x="26" y="64" width="68" height="11" rx="2" />
      <rect x="33" y="52" width="54" height="11" rx="2" opacity="0.85" />
      <rect x="40" y="40" width="40" height="11" rx="2" opacity="0.7" />
      <rect x="47" y="28" width="26" height="11" rx="2" opacity="0.55" />
      <rect x="54" y="16" width="12" height="11" rx="2" opacity="0.4" />
      <path d="M60 2l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z" fill="currentColor" stroke="none" />
    </>
  ),
  /* catcher — basket, falling badge, bomb */
  catcher: (
    <>
      <path d="M36 62h48l-8 17H44z" />
      <path d="M32 62h56" strokeWidth="4" />
      <path d="M40 68l2.5 6M80 68l-2.5 6M60 68v6" opacity="0.45" />
      <path d="M68 24l7 8-7 8-7-8z" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M58 8v7M66 6v7M76 10v7" opacity="0.5" />
      <circle cx="34" cy="34" r="8" />
      <path d="M37 27q4-5 9-4" />
      <path d="M48 20l3 3M51 20l-3 3M49 18v6" opacity="0.7" />
    </>
  ),
  /* fallback — neutral badge orbit */
  fallback: (
    <>
      <circle cx="60" cy="45" r="26" opacity="0.4" />
      <path d="M60 33l9 12-9 12-9-12z" fill="currentColor" stroke="none" />
      <path d="M60 19v-6M86 45h6M60 71v6M28 45h-6" opacity="0.5" />
    </>
  ),
};

export default function GameArt({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 120 90"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ART[id] ?? ART.fallback}
    </svg>
  );
}
