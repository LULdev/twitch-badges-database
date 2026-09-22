import { useTranslations } from "next-intl";
import { levelTheme } from "@/lib/gamification/levels";

/**
 * Level badge (1–100): unique bracket-themed shield with the level number,
 * animated sparkles and glow. ALWAYS visible on profiles — cannot be hidden.
 */
export default function LevelBadge({
  level,
  size = 72,
  halo,
}: {
  level: number;
  size?: number;
  /** Overrides the tier's default halo colour (the profile customizer uses it). */
  halo?: string;
}) {
  const t = useTranslations("common");
  const theme = levelTheme(level);
  return (
    <span
      className="level-badge relative inline-grid place-items-center"
      style={{
        width: size,
        height: size,
        ["--level-glow" as string]: theme.glow,
        // The inline value shadows any wrapper, so an override has to be
        // passed in here rather than set on a parent element.
        ["--level-halo" as string]: halo ?? theme.halo,
      }}
      role="img"
      aria-label={t("levelAria", { level })}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full drop-shadow-[0_0_8px_var(--level-halo)]">
        <defs>
          <linearGradient id={`lg-${level}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <path
          d="M32 2 58 12v22c0 15-11 24-26 28C17 58 6 49 6 34V12L32 2z"
          fill={`url(#lg-shield-${level})`}
          style={{ fill: theme.gradient.includes("conic") ? undefined : theme.gradient }}
          stroke={theme.glow}
          strokeWidth="2.5"
        />
        {level >= 90 && (
          <path
            d="M32 2 58 12v22c0 15-11 24-26 28C17 58 6 49 6 34V12L32 2z"
            fill="none"
            stroke={`url(#lg-shield-${level})`}
            strokeWidth="2.5"
            className="level-badge-rotate"
          />
        )}
        <linearGradient id={`lg-shield-${level}`}>
          <stop offset="0%" stopColor={theme.glow} stopOpacity="0.35" />
          <stop offset="100%" stopColor={theme.glow} stopOpacity="0.08" />
        </linearGradient>
      </svg>
      <span className="relative z-10 font-black tabular-nums" style={{ fontSize: size * 0.34, color: theme.glow }}>
        {level}
      </span>
      <span className="level-sparkle sparkle-a" aria-hidden />
      <span className="level-sparkle sparkle-b" aria-hidden />
    </span>
  );
}
