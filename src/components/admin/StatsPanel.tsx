"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import CountUp from "@/components/stats/CountUp";
import Reveal from "@/components/stats/Reveal";
import TrendChart, { type TrendSeries } from "@/components/stats/TrendChart";
import DonutChart, { type DonutSlice } from "@/components/stats/DonutChart";
import DistributionBars from "@/components/stats/DistributionBars";
import type { AnalyticsBundle } from "@/lib/analytics";

const CLIENT_COLORS = ["#a970ff", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#f87171", "#9aa0b0"];

interface Payload extends AnalyticsBundle {
  system?: Record<string, number | string | null>;
}

export default function StatsPanel({ locale }: { locale: string }) {
  const t = useTranslations("admin.stats");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
    } catch {
      setError(t("loadFailed"));
    }
  }, [setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (!data) {
    return <p className="card p-6 text-sm text-muted">{error ?? t("loading")}</p>;
  }

  const summary = data.summary;
  const series: TrendSeries[] = [
    { key: "hits", label: t("chart.hits"), color: "#a970ff" },
    { key: "visitors", label: t("chart.visitors"), color: "#34d399" },
  ];
  const daily = data.daily.slice(-30).map((row) => ({
    label: new Date(row.day).toLocaleDateString(locale, { month: "short", day: "numeric" }),
    hits: Number(row.hits),
    visitors: Number(row.visitors),
  }));

  const deviceSlices: DonutSlice[] = Object.entries(
    data.clients.reduce<Record<string, number>>((acc, row) => {
      const key = row.device || "unknown";
      acc[key] = (acc[key] ?? 0) + Number(row.hits);
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([key, value], index) => ({
      key,
      label: key,
      value,
      color: CLIENT_COLORS[index % CLIENT_COLORS.length],
    }));

  const browsers: Array<Record<string, string | number>> = Object.entries(
    data.clients.reduce<Record<string, number>>((acc, row) => {
      const key = row.browser || "unknown";
      acc[key] = (acc[key] ?? 0) + Number(row.hits);
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([key, hits]) => ({ key, label: key, value: hits as number })) as Array<
    Record<string, string | number>
  >;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["online", summary?.online_now ?? 0],
          ["views24", summary?.hits_24h ?? 0],
          ["views7", summary?.hits_7d ?? 0],
          ["views30", summary?.hits_30d ?? 0],
          ["total", summary?.total_hits ?? 0],
          ["unique", summary?.unique_visitors ?? 0],
        ].map(([key, value], index) => (
          <Reveal key={key as string} delay={index * 40}>
            <div className="card p-4">
              <p className="text-xs font-semibold text-muted">{t(`kpi.${key}`)}</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight">
                <CountUp value={Number(value)} locale={locale} />
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold">{t("chart.title")}</h3>
          {daily.length > 0 ? (
            <TrendChart data={daily} series={series} ariaLabel={t("chart.title")} />
          ) : (
            <p className="text-sm text-muted">{t("noData")}</p>
          )}
        </div>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold">{t("devices")}</h3>
            {deviceSlices.length > 0 ? (
              <DonutChart
                data={deviceSlices}
                ariaLabel={t("devices")}
                centerValue={String(summary?.hits_30d ?? 0)}
                centerLabel={t("chart.hits")}
              />
            ) : (
              <p className="text-sm text-muted">{t("noData")}</p>
            )}
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold">{t("browsers")}</h3>
            {browsers.length > 0 ? (
              <DistributionBars rows={browsers as never} locale={locale} />
            ) : (
              <p className="text-sm text-muted">{t("noData")}</p>
            )}
          </div>
        </Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal>
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-bold">{t("topPaths")}</h3>
            {data.paths.length > 0 ? (
              <DistributionBars
                rows={data.paths.map((row) => ({ key: row.path, label: row.path, value: Number(row.hits) }))}
                locale={locale}
                labelWidth="10rem"
              />
            ) : (
              <p className="text-sm text-muted">{t("noData")}</p>
            )}
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-bold">{t("referrers")}</h3>
            {data.referrers.length > 0 ? (
              <DistributionBars
                rows={data.referrers.map((row) => ({
                  key: row.referrer_host,
                  label: row.referrer_host,
                  value: Number(row.hits),
                }))}
                locale={locale}
                labelWidth="10rem"
              />
            ) : (
              <p className="text-sm text-muted">{t("noData")}</p>
            )}
          </div>
        </Reveal>
      </div>

      <Reveal>
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-bold">{t("locales")}</h3>
          {data.locales.length > 0 ? (
            <DistributionBars
              rows={data.locales.map((row) => ({ key: row.locale, label: row.locale, value: Number(row.hits) }))}
              locale={locale}
              labelWidth="4rem"
            />
          ) : (
            <p className="text-sm text-muted">{t("noData")}</p>
          )}
          <p className="mt-3 text-xs text-muted">
            {t("privacy", {
              avg: summary?.avg_duration_s ?? 0,
            })}
          </p>
        </div>
      </Reveal>
    </div>
  );
}