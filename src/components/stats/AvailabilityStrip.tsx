import type { CSSProperties } from "react";

export interface HourBucket {
  hour: string;
  checks: number;
  ok: number;
}

/**
 * 48-hour availability strip — one bar per hour, height by check volume,
 * red when the hour contained a failed run. Server component.
 */
export default function AvailabilityStrip({
  hours,
  locale = "en",
  emptyLabel,
}: {
  hours: HourBucket[];
  locale?: string;
  emptyLabel: string;
}) {
  const byHour = new Map<string, HourBucket>();
  for (const bucket of hours) {
    byHour.set(new Date(bucket.hour).toISOString().slice(0, 13), bucket);
  }

  const series: Array<HourBucket & { label: string }> = [];
  const cursor = new Date();
  cursor.setUTCMinutes(0, 0, 0);
  for (let index = 47; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setUTCHours(date.getUTCHours() - index);
    const key = date.toISOString().slice(0, 13);
    const bucket = byHour.get(key) ?? { hour: key, checks: 0, ok: 0 };
    series.push({
      ...bucket,
      label: `${String(date.getUTCHours()).padStart(2, "0")}:00`,
    });
  }

  const peak = Math.max(1, ...series.map((bucket) => bucket.checks));
  const formatter = new Intl.NumberFormat(locale);

  return (
    <div className="strip">
      {series.map((bucket, index) => {
        const failed = bucket.checks > 0 && bucket.ok < bucket.checks;
        const height =
          bucket.checks === 0 ? 8 : Math.max(12, (bucket.checks / peak) * 100);
        return (
          <span
            key={bucket.hour}
            className={`strip-bar ${
              bucket.checks === 0 ? "is-empty" : failed ? "is-bad" : ""
            }`}
            style={
              {
                height: `${height}%`,
                "--d": `${index * 14}ms`,
              } as CSSProperties
            }
            title={
              bucket.checks === 0
                ? `${bucket.label} · ${emptyLabel}`
                : `${bucket.label} · ${formatter.format(bucket.ok)}/${formatter.format(bucket.checks)}`
            }
          />
        );
      })}
    </div>
  );
}
