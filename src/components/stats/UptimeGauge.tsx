import type { CSSProperties } from "react";

/**
 * Circular availability gauge. The sweep is animated in CSS from the full
 * circumference down to the measured offset, so it works from a server render.
 */
export default function UptimeGauge({
  value,
  caption,
  size = 132,
  stroke = 10,
  color,
  delay = 0,
  locale,
}: {
  /** 0–100, or null when there is no data yet. */
  value: number | null;
  caption: string;
  size?: number;
  stroke?: number;
  color?: string;
  delay?: number;
  /** Locale for the decimal separator; `toFixed` would always emit ".". */
  locale: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);
  const tone =
    value === null
      ? "var(--muted)"
      : clamped >= 99
        ? "var(--success)"
        : clamped >= 95
          ? "var(--warning)"
          : "var(--danger)";

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle
          className="gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="gauge-arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={color ?? tone}
          strokeDasharray={circumference}
          style={
            {
              "--gauge-from": `${circumference}`,
              "--gauge-to": `${offset}`,
              animationDelay: `${delay}ms`,
            } as CSSProperties
          }
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-value">
          {value === null
            ? "—"
            : `${new Intl.NumberFormat(locale, {
                minimumFractionDigits: clamped >= 99.95 ? 1 : 2,
                maximumFractionDigits: clamped >= 99.95 ? 1 : 2,
              }).format(value)}%`}
        </div>
        <div className="gauge-caption">{caption}</div>
      </div>
    </div>
  );
}
