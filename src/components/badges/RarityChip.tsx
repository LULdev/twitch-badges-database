import { RARITY_COLORS, type RarityTier } from "@/lib/rarity";
import { useTranslations } from "next-intl";

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
      <span className="rarity-dot" aria-hidden />
      {t(tier)}
      {!compact && score !== undefined ? (
        <span className="rarity-score">{score}</span>
      ) : null}
    </span>
  );
}
