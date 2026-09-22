"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale } from "next-intl";
import { useChartTheme } from "./useChartTheme";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

export interface TrendPoint {
  label: string;
  [key: string]: number | string | null;
}

// The locale is a parameter: a hardcoded "en" grouped numbers the English way
// on the ten other locales ("1.2M" instead of "1,2 Mio.").
function compact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact" }).format(value);
}

/** Animated multi-series area chart used for the 30-day trends. */
export default function TrendChart({
  data,
  series,
  ariaLabel,
  height = 260,
}: {
  data: TrendPoint[];
  series: TrendSeries[];
  ariaLabel: string;
  height?: number;
}) {
  const theme = useChartTheme();
  const locale = useLocale();

  if (data.length === 0) return null;

  return (
    <div className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((entry) => (
              <linearGradient
                key={entry.key}
                id={`trend-${entry.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={entry.color} stopOpacity={0.55} />
                <stop offset="100%" stopColor={entry.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            stroke={theme.line}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: theme.muted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.line }}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: theme.muted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => compact(value, locale)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.surface2,
              border: `1px solid ${theme.line}`,
              borderRadius: 10,
              fontSize: 12,
              color: theme.foreground,
            }}
            labelStyle={{ color: theme.foreground, fontWeight: 600 }}
            formatter={(value, name) => {
              const label =
                series.find((entry) => entry.key === String(name))?.label ??
                String(name);
              return [
                new Intl.NumberFormat(locale).format(Number(value ?? 0)),
                label,
              ];
            }}
          />
          {series.map((entry) => (
            <Area
              key={entry.key}
              type="monotone"
              dataKey={entry.key}
              name={entry.key}
              stroke={entry.color}
              strokeWidth={2}
              fill={`url(#trend-${entry.key})`}
              animationDuration={1200}
              animationEasing="ease-out"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
