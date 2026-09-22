"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useLocale } from "next-intl";
import { useChartTheme } from "./useChartTheme";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Animated donut for "where do XP and BadgesCoins come from" splits. */
export default function DonutChart({
  data,
  ariaLabel,
  height = 240,
  centerValue,
  centerLabel,
}: {
  data: DonutSlice[];
  ariaLabel: string;
  height?: number;
  centerValue?: string;
  centerLabel?: string;
}) {
  const theme = useChartTheme();
  const locale = useLocale();
  const slices = data.filter((slice) => slice.value > 0);
  if (slices.length === 0) return null;

  return (
    <div className="relative w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              backgroundColor: theme.surface2,
              border: `1px solid ${theme.line}`,
              borderRadius: 10,
              fontSize: 12,
              color: theme.foreground,
            }}
            labelStyle={{ color: theme.foreground, fontWeight: 600 }}
            formatter={(value, name) => [
              new Intl.NumberFormat(locale).format(Number(value ?? 0)),
              String(name),
            ]}
          />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
            animationDuration={1100}
            animationEasing="ease-out"
          >
            {slices.map((slice) => (
              <Cell key={slice.key} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <div className="gauge-value">{centerValue}</div>
          {centerLabel ? <div className="gauge-caption">{centerLabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
