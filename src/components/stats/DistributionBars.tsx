import type { CSSProperties } from "react";

export interface DistributionRow {
  key: string;
  label: string;
  value: number;
  hint?: string;
  color?: string;
}

/**
 * Animated horizontal distribution bars. Pure CSS animation (scaleX grow-in
 * with a staggered delay), so this stays a server component.
 */
export default function DistributionBars({
  rows,
  locale = "en",
  max,
  delayStep = 55,
  labelWidth = "7rem",
}: {
  rows: DistributionRow[];
  locale?: string;
  max?: number;
  delayStep?: number;
  labelWidth?: string;
}) {
  if (rows.length === 0) return null;
  const peak = max ?? Math.max(1, ...rows.map((row) => row.value));
  const format = new Intl.NumberFormat(locale);

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        const width = peak > 0 ? Math.max(1.5, (row.value / peak) * 100) : 0;
        return (
          <div key={row.key} className="grow-bar">
            <span
              className="shrink-0 truncate text-xs font-semibold text-muted"
              style={{ width: labelWidth }}
              title={row.label}
            >
              {row.label}
            </span>
            <div className="grow-bar-track">
              <div
                className="grow-bar-fill"
                style={
                  {
                    width: `${width}%`,
                    "--bar-color": row.color ?? "var(--accent)",
                    "--d": `${index * delayStep}ms`,
                  } as CSSProperties
                }
              />
            </div>
            <span className="w-16 shrink-0 text-end text-xs font-bold tabular-nums">
              {format.format(row.value)}
            </span>
            <span className="w-14 shrink-0 text-end text-[11px] text-muted tabular-nums">
              {row.hint ?? ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
