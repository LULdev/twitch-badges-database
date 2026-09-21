import type { CSSProperties } from "react";

export interface HistogramBucket {
  key: string;
  label: string;
  value: number;
  hint?: string;
  color?: string;
}

/** Animated column histogram (level distribution). Server component. */
export default function LevelHistogram({
  buckets,
  ariaLabel,
}: {
  buckets: HistogramBucket[];
  ariaLabel: string;
}) {
  if (buckets.length === 0) {
    return null;
  }
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.value));

  return (
    <div className="histo" role="img" aria-label={ariaLabel}>
      {buckets.map((bucket, index) => {
        const height = bucket.value > 0 ? Math.max(4, (bucket.value / peak) * 100) : 2;
        return (
          <div
            key={bucket.key}
            className="histo-col"
            title={`${bucket.label}: ${bucket.value}${bucket.hint ? ` · ${bucket.hint}` : ""}`}
          >
            <span className="text-[10px] font-bold text-muted tabular-nums">
              {bucket.value > 0 ? bucket.value : ""}
            </span>
            <div
              className="histo-bar"
              style={
                {
                  height: `${height}%`,
                  "--bar-color": bucket.color ?? "var(--accent)",
                  "--d": `${index * 70}ms`,
                } as CSSProperties
              }
            />
          </div>
        );
      })}
    </div>
  );
}
