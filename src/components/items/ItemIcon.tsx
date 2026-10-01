import type { ReactNode } from "react";

/**
 * Inventory item artwork, mirroring the GameArt contract exactly (viewBox
 * 120x90, stroke currentColor, strokeWidth 3, aria-hidden, map + fallback,
 * direction-neutral geometry, no baked text). Deliberately NOT a GameArt id:
 * the economy item namespace stays separate from the game registry so future
 * items (boosts, tickets…) slot in as new keys here.
 */

/** Decorative per-item hue, consumed by the shelf via `--tier-color`. */
export const ITEM_COLORS: Record<string, string> = {
  streak_freeze: "#38bdf8",
};

const ART: Record<string, ReactNode> = {
  /* shield cradling a snowflake — a streak kept safe through a cold day.
     The flake lives in its own group so CSS can turn it inside the still
     shield (`.item-flake`, transform-box: fill-box — the group's bbox is
     centered on the shield's visual center, 60/45). */
  streak_freeze: (
    <>
      <path d="M60 8 92 20v26c0 18-13 30-32 38C41 76 28 64 28 46V20z" />
      <g className="item-flake">
        <path d="M60 28v34M43 38l34 14M77 38 43 52" opacity="0.85" />
        <path d="M49 34l11 6 11-6M49 56l11-6 11 6" opacity="0.5" />
        <circle cx="60" cy="45" r="3.5" fill="currentColor" stroke="none" opacity="0.85" />
      </g>
    </>
  ),
  /* fallback — neutral pouch */
  fallback: (
    <>
      <path d="M38 26h44l8 18-30 34-30-34z" />
      <path d="M38 44h44" opacity="0.5" />
      <circle cx="60" cy="56" r="4" fill="currentColor" stroke="none" opacity="0.6" />
    </>
  ),
};

export default function ItemIcon({ id }: { id: string }) {
  return (
    <svg
      className="item-icon"
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
