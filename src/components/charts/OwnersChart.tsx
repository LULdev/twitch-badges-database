"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { useChartTheme } from "@/components/stats/useChartTheme";

export interface OwnersChartPoint {
  label: string;
  owners: number | null;
  active: number | null;
  /**
   * Owner count recovered from a public archive capture. Set on archive rows
   * only, where `owners`/`active` are null. Optional so a caller that has not
   * been migrated to the archive pass still type-checks.
   */
  ownersArchived?: number | null;
  /** Provenance of the row. Absent means "measured", the pre-archive default. */
  source?: "measured" | "archive";
}

export default function OwnersChart({ data }: { data: OwnersChartPoint[] }) {
  const t = useTranslations("stats");
  const locale = useLocale();
  // SVG presentation attributes cannot resolve `var()`, so the tokens are
  // resolved to real colours here like every other chart in this set.
  const theme = useChartTheme();
  const compact = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : new Intl.NumberFormat(locale, { notation: "compact" }).format(value);

  // The guard is on the row count, not on `owners`, so an archive-only badge
  // (every measured value null) still renders. A single row total stays hidden:
  // one point is not a trend, with or without provenance.
  if (data.length < 2) return null;

  // Driven off the presence of archived *values* rather than the `source` flag
  // alone, so a row that carries an archived count is never silently dropped by
  // a caller that forgot the marker.
  const hasArchived = data.some(
    (point) => point.ownersArchived !== null && point.ownersArchived !== undefined,
  );

  return (
    <div className="w-full">
      <div className="h-64 w-full" role="img" aria-label={t("legendOwners")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={theme.line} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: theme.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: theme.line }}
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: theme.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) => compact(value)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.surface2,
                border: `1px solid ${theme.line}`,
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: theme.foreground }}
              formatter={(value, name, item) => {
                // `item.payload` is the raw chart row, so the point's own
                // `source` decides the marker. The series name is only a
                // fallback: a tooltip can be configured to hide inactive series,
                // and a hidden series must not switch the marker off.
                const point = item?.payload as OwnersChartPoint | undefined;
                const archived =
                  point?.source === "archive" || String(name) === "ownersArchived";
                // A gap stays a gap. Formatting null through Number() yielded
                // "0", which is a claim about a badge; the em dash the helper
                // already knows how to produce is the honest rendering, and the
                // archive pass makes nulls structural — every archived row nulls
                // `owners`/`active` and vice versa.
                const missing = value === null || value === undefined;
                // Both owner series share one label: they are the same quantity,
                // provenance is the only difference. The archived marker is
                // composed as a string because recharts types the tooltip's name
                // slot as string|number, not a ReactNode.
                const label =
                  String(name) === "active" ? t("legendActive") : t("legendOwners");
                return [
                  compact(value as number | null | undefined),
                  archived && !missing ? `${label} (${t("legendArchived")})` : label,
                ];
              }}
            />
            <Line
              type="monotone"
              dataKey="owners"
              stroke={theme.accent}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="active"
              stroke={theme.info}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            {hasArchived ? (
              // Archived captures are discrete observations taken on dates no
              // one chose, so they are drawn as a dashed stroke with visible
              // per-point dots. `connectNulls` is safe HERE and only here: it
              // operates per series, and every measured row nulls
              // `ownersArchived`, so it can only ever connect archive point to
              // archive point. Without it a capture-per-year series renders as
              // a scatter of single-point segments and the dashed line the
              // legend advertises never appears. The measured and active lines
              // keep `connectNulls` exactly as before, so nothing ever bridges
              // the measured era into the archive or back. The warning token
              // (not `muted`, which already means "axis tick / no value" in
              // this very chart) says "recovered, treat with care".
              <Line
                type="monotone"
                dataKey="ownersArchived"
                stroke={theme.warning}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasArchived ? (
        // Only rendered when there is an archived series to explain; with
        // measured-only data the chart is what it was before the archive pass
        // existed, empty legend and all. `.chart-legend`/`.swatch` are the
        // established legend classes in this set (see /stats); `.chip` is not
        // used because it carries cursor:pointer and a hover state, which would
        // advertise a click target that does nothing.
        <div className="chart-legend mt-3">
          <span>
            <span className="swatch" style={{ background: theme.accent }} aria-hidden="true" />
            {t("legendOwners")}
          </span>
          <span>
            <span className="swatch" style={{ background: theme.info }} aria-hidden="true" />
            {t("legendActive")}
          </span>
          <span>
            {/* Outline rather than fill: the archived series is a dashed line, and
                a solid swatch would claim it is only a different colour. */}
            <span
              className="swatch"
              style={{ background: "transparent", border: `1px dashed ${theme.warning}` }}
              aria-hidden="true"
            />
            {t("legendArchived")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
