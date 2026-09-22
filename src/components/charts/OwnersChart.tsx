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

  if (data.length < 2) return null;

  return (
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
            formatter={(value, name) => [
              compact(Number(value)),
              String(name) === "owners" ? t("legendOwners") : t("legendActive"),
            ]}
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
