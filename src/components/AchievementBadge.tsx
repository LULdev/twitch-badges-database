import type { AchievementCategory } from "@/lib/gamification/achievements";

const CATEGORY_STYLE: Record<AchievementCategory, { ring: string; icon: string; label: string }> = {
  common: { ring: "#9aa0b0", icon: "★", label: "★" },
  creative: { ring: "#fbbf24", icon: "✦", label: "✦" },
  special: { ring: "#a970ff", icon: "♛", label: "♛" },
};

/**
 * Sparkle-animated achievement badge, shown in the profile hero showcase.
 * common = silver star, creative = gold, special = mythic crown.
 */
export default function AchievementBadge({
  title,
  category,
  size = 56,
}: {
  title: string;
  category: AchievementCategory;
  size?: number;
}) {
  const style = CATEGORY_STYLE[category];
  return (
    <span
      className={`achievement-badge achievement-${category} relative inline-grid place-items-center rounded-full border-2`}
      style={{
        width: size,
        height: size,
        borderColor: style.ring,
        // The special tier draws its own conic ring and pulse in CSS; an inline
        // background here overrode that, so every special badge looked plain.
        ...(category === "special"
          ? {}
          : {
              boxShadow: `0 0 10px ${style.ring}55, inset 0 0 8px ${style.ring}22`,
              background: `radial-gradient(circle at 30% 25%, ${style.ring}33, transparent 70%)`,
            }),
      }}
      title={title}
      role="img"
      aria-label={title}
    >
      <span style={{ color: style.ring, fontSize: size * 0.4 }}>{style.icon}</span>
      <span className="level-sparkle sparkle-a" aria-hidden />
      <span className="level-sparkle sparkle-b" aria-hidden />
    </span>
  );
}
