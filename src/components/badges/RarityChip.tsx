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
  const color = RARITY_COLORS[tier];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.06em]"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
      title={score !== undefined ? `${score}/100` : undefined}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {t(tier)}
      {!compact && score !== undefined ? (
        <span className="font-semibold opacity-70">{score}</span>
      ) : null}
    </span>
  );
}
