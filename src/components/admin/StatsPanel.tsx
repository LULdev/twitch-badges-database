"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import CountUp from "@/components/stats/CountUp";
import Reveal from "@/components/stats/Reveal";
import TrendChart, { type TrendSeries } from "@/components/stats/TrendChart";
import DonutChart, { type DonutSlice } from "@/components/stats/DonutChart";
import DistributionBars from "@/components/stats/DistributionBars";
import type { AnalyticsBundle } from "@/lib/analytics";
import { formatCompact } from "@/components/badges/BadgeCard";

const CLIENT_COLORS = ["#a970ff", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#f87171", "#9aa0b0"];

interface EconomyRow {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  coins_wagered: number;
  coins_won: number;
  coins_lost: number;
  coins_net: number;
  rounds_played: number;
  rounds_won: number;
  win_rate: number;
  wheel_spins: number;
  jackpot_wins: number;
}

interface Payload extends AnalyticsBundle {
  system?: Record<string, number | string | null>;
  playerEconomy?: EconomyRow[];
  economyAlerts?: EconomyAlert[];
  economyAlertNights?: Array<{ day: string; count: number }>;
}

interface EconomyAlert {
  id: number;
  username: string | null;
  kind: "win_rate" | "wager_spike";
  detail: Record<string, unknown>;
  created_at: string;
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

      {(data?.economyAlerts?.length ?? 0) > 0 && (
        <div className="card border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-bold text-warning">{t("alerts.title")}</p>
          <ul className="mt-2 space-y-1">
            {data!.economyAlerts!.slice(0, 5).map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{alert.username ?? "—"}</span>
                <span className="text-muted">
                  {alert.kind === "win_rate"
                    ? t("alerts.winRate", {
                        rate: String(alert.detail.win_rate ?? "?"),
                        rounds: String(alert.detail.rounds ?? "?"),
                      })
                    : t("alerts.wagerSpike", {
                        thisWeek: String(alert.detail.this_week ?? "?"),
                        factor: String(alert.detail.factor ?? "?"),
                      })}
                </span>
              </li>
            ))}
          </ul>
          {(data?.economyAlertNights?.length ?? 0) > 0 && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              {t("alerts.series")}
              <span className="flex items-center gap-1" dir="ltr">
                {data!.economyAlertNights!.map((night) => (
                  <span
                    key={night.day}
                    title={night.day}
                    className={
                      "inline-grid size-5 place-items-center rounded text-[0.5625rem] font-bold tabular-nums " +
                      (night.count > 0 ? "bg-warning/20 text-warning" : "bg-surface-3 text-muted")
                    }
                  >
                    {night.count}
                  </span>
                ))}
              </span>
            </p>
          )}
          <p className="mt-2 text-xs text-muted">{t("alerts.note")}</p>
        </div>
      )}

      {(data?.playerEconomy?.length ?? 0) > 0 && (
        <Reveal>
          <div className="card overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-sm font-bold">{t("economy.title")}</h3>
              <p className="mt-0.5 text-xs text-muted">{t("economy.desc")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <th>{t("economy.member")}</th>
                    <th className="text-end">{t("economy.wagered")}</th>
                    <th className="text-end">{t("economy.won")}</th>
                    <th className="text-end">{t("economy.lost")}</th>
                    <th className="text-end">{t("economy.net")}</th>
                    <th className="text-end">{t("economy.rounds")}</th>
                    <th className="text-end">{t("economy.winRate")}</th>
                    <th className="text-end">{t("economy.jackpots")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.playerEconomy!.map((row, index) => (
                    <tr key={row.user_id} className="hover:bg-surface-2">
                      <td className="font-bold tabular-nums text-muted">{index + 1}</td>
                      <td>
                        <span className="flex items-center gap-2 font-semibold">
                          {row.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.avatar_url} alt="" width={22} height={22} className="rounded-full" loading="lazy" />
                          ) : (
                            <span className="grid size-5.5 place-items-center rounded-full bg-accent-soft text-[0.5625rem] font-bold text-accent">
                              {(row.username ?? "?").slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          {row.username ?? "—"}
                        </span>
                      </td>
                      <td dir="ltr" className="text-end font-semibold tabular-nums">{formatCompact(row.coins_wagered, locale)}</td>
                      <td dir="ltr" className="text-end tabular-nums text-success">+{formatCompact(row.coins_won, locale)}</td>
                      <td dir="ltr" className="text-end tabular-nums text-danger">−{formatCompact(row.coins_lost, locale)}</td>
                      <td dir="ltr" className={"text-end font-semibold tabular-nums " + (row.coins_net >= 0 ? "text-success" : "text-danger")}>
                        {row.coins_net >= 0 ? "+" : "−"}{formatCompact(Math.abs(row.coins_net), locale)}
                      </td>
                      <td dir="ltr" className="text-end tabular-nums">{row.rounds_played}</td>
                      <td dir="ltr" className="text-end tabular-nums">{row.win_rate}%</td>
                      <td dir="ltr" className="text-end tabular-nums">{row.jackpot_wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      )}

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
          <h3 className="mb-2 text-sm font-bold">{t("recapRefs")}</h3>
          {data.recapRefs.length > 0 ? (
            <DistributionBars
              rows={data.recapRefs.map((row) => ({
                key: row.path,
                label: row.path,
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