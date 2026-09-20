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
import { useTranslations } from "next-intl";

export interface OwnersChartPoint {
  label: string;
  owners: number | null;
  active: number | null;
}

export default function OwnersChart({ data }: { data: OwnersChartPoint[] }) {
  const t = useTranslations("stats");

  if (data.length < 2) return null;

  return (
    <div className="h-64 w-full" role="img" aria-label={t("legendOwners")}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) =>
              new Intl.NumberFormat("en", { notation: "compact" }).format(value)
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--surface-2)",
              border: "1px solid var(--line-strong)",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--foreground)" }}
            formatter={(value, name) => [
              value === null || value === undefined
                ? "—"
                : new Intl.NumberFormat("en", { notation: "compact" }).format(
                    Number(value),
                  ),
              String(name) === "owners" ? t("legendOwners") : t("legendActive"),
            ]}
          />
          <Line
            type="monotone"
            dataKey="owners"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="active"
            stroke="var(--info)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
