import { RARITY_COLORS, type RarityTier } from "@/lib/rarity";
import { useTranslations } from "next-intl";

/**
 * Animated rarity badge: a glowing gem (rotated diamond) with tier-colored
 * gradient, shimmer sweep and — for legendary/mythic — a rotating conic
 * border plus sparkles. All animation lives in globals.css and respects
 * prefers-reduced-motion.
 */
export default function RarityChip({
  tier,
  score,
  compact = false,
}: {
  tier: RarityTier;
  score?: number;
  compact?: boolean;
}) {
  const t = useTranslations("rarity");
  return (
    <span
      className={`rarity-chip rarity-${tier}`}
      style={{ ["--tier-color" as string]: RARITY_COLORS[tier] }}
      title={score !== undefined ? `${score}/100` : undefined}
    >
      <span className="rarity-gem" aria-hidden>
        <span className="rarity-gem-core" />
        {(tier === "legendary" || tier === "mythic") && (
          <>
            <span className="rarity-sparkle sparkle-a" />
            <span className="rarity-sparkle sparkle-b" />
          </>
        )}
      </span>
      {t(tier)}
      {!compact && score !== undefined ? (
        <span className="rarity-score">{score}</span>
      ) : null}
    </span>
  );
}
