/**
 * Three ascending signal bars in a color-coded pill — the changelog risk
 * indicator (low/medium/high). Server component; labels are passed in
 * translated so both the changelog page and the status incidents feed can
 * use it with their own namespaces.
 */
export function RiskBars({ level }: { level: string }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const color =
    level === "high"
      ? "var(--danger)"
      : level === "medium"
        ? "var(--warning)"
        : "var(--success)";
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={i * 4}
          y={7 - i * 2.5}
          width="2.5"
          height={3 + i * 2.5}
          rx="0.5"
          fill={i < filled ? color : "var(--surface-3)"}
        />
      ))}
    </svg>
  );
}

export default function RiskChip({
  level,
  label,
  hint,
  compact = false,
}: {
  level: string;
  label: string;
  hint: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`risk-chip risk-${level} ${compact ? "risk-chip--compact" : ""}`}
      title={`${label} — ${hint}`}
    >
      <RiskBars level={level} />
      {!compact && <span>{label}</span>}
    </span>
  );
}
