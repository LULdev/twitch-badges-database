import type { CSSProperties } from "react";

export interface CalendarCell {
  day: string;
  checks: number;
  ok: number;
  errors: number;
  avgMs: number | null;
}

/** Which availability bucket a day falls into (0 = no data). */
function level(cell: CalendarCell | undefined): number {
  if (!cell || cell.checks === 0) return 0;
  const ratio = cell.ok / cell.checks;
  if (ratio >= 1) return 4;
  if (ratio >= 0.95) return 3;
  if (ratio >= 0.8) return 2;
  return 1;
}

/**
 * 30-day availability calendar — one cell per day, green intensity by success
 * rate, red as soon as a run failed. Server component, CSS-staggered fade-in.
 */
export default function UptimeCalendar({
  cells,
  locale = "en",
  labels,
}: {
  cells: CalendarCell[];
  locale?: string;
  labels: { noData: string; runs: string; failures: string; avg: string };
}) {
  const formatDay = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
  });
  const formatMs = new Intl.NumberFormat(locale);

  return (
    <div className="uptime-grid">
      {cells.map((cell, index) => {
        const bucket = level(cell);
        const hasErrors = cell.errors > 0;
        const title =
          cell.checks === 0
            ? `${formatDay.format(new Date(`${cell.day}T00:00:00Z`))} · ${labels.noData}`
            : [
                formatDay.format(new Date(`${cell.day}T00:00:00Z`)),
                `${cell.checks} ${labels.runs}`,
                hasErrors ? `${cell.errors} ${labels.failures}` : null,
                cell.avgMs !== null ? `${labels.avg} ${formatMs.format(cell.avgMs)} ms` : null,
              ]
                .filter(Boolean)
                .join(" · ");

        return (
          <span
            key={cell.day}
            title={title}
            className={`uptime-cell ${hasErrors ? "uptime-bad" : `uptime-${bucket}`}`}
            style={{ "--d": `${index * 18}ms` } as CSSProperties}
          />
        );
      })}
    </div>
  );
}
