import { getLocale, getTranslations } from "next-intl/server";
import Coin from "@/components/Coin";
import TrendChart from "@/components/stats/TrendChart";
import type { JackpotEconomyData, JackpotHistoryPoint } from "@/lib/stats";

/**
 * Public economy card on /stats: the progressive-jackpot aggregates from the
 * stats_jackpot_economy view (0070) — live pots, all-time contributions and
 * payouts, the biggest win, the 7-day win activity — plus the pot-growth
 * chart from the nightly history snapshots (0072). Aggregates only, no
 * per-user data; the tile markup mirrors CommunityCoinFlow deliberately
 * (same bl-kpi tiles, only the strings and the data source differ).
 */
export default async function JackpotEconomy({
  data,
  history,
  id = "jackpot-economy",
}: {
  data: JackpotEconomyData;
  /** Pot levels per day, oldest first; fewer than 2 points hides the chart. */
  history: JackpotHistoryPoint[];
  id?: string;
}) {
  const t = await getTranslations("stats");
  const locale = await getLocale();
  const fmt = (value: number) => value.toLocaleString(locale);
  // Pot LEVELS, not flows: the series is exactly the days the snapshot ran —
  // no zero-fill (a missing day is unknown, not zero) — and the label matches
  // the daySeries format the other /stats charts use.
  // Staleness signal: the nightly snapshot should run every UTC day. A gap
  // of more than one day means a cron night was missed — the flat line after
  // it would silently read as "the pot stopped growing" otherwise.
  const lastSnapshotDay = history.length > 0 ? history[history.length - 1].day : null;
  const snapshotStaleDays = (() => {
    if (!lastSnapshotDay) return 0;
    const last = Date.parse(lastSnapshotDay + "T00:00:00Z");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today.getTime() - last) / 86_400_000) - 1);
  })();
  const chartData = history.map((point) => {
    const [, month, day] = point.day.split("-");
    return {
      label: `${Number(day)}.${Number(month)}.`,
      mega: point.mega,
      total: point.total,
    };
  });

  return (
    <section className="card p-5" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-extrabold tracking-tight">
        {t("jackpotTitle")}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="bl-kpi">
          <b dir="ltr" className="inline-flex items-center gap-1 text-warning">
            {fmt(data.megaPot)} <Coin size={11} variant="b" />
          </b>
          <span>{t("jackpotMega")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr" className="inline-flex items-center gap-1">
            {fmt(data.gamePotsTotal)} <Coin size={11} />
          </b>
          <span>{t("jackpotGames")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr">{fmt(data.contributionsTotal)}</b>
          <span>{t("jackpotContributed")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr" className={data.totalPaid > 0 ? "text-success" : undefined}>
            {fmt(data.totalPaid)}
          </b>
          <span>{t("jackpotPaid")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr">{fmt(data.biggestWin)}</b>
          <span>{t("jackpotBiggest")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr">{fmt(data.hitsTotal)}</b>
          <span>{t("jackpotHits")}</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        {t("jackpotNote")}{" "}
        {t("jackpotWeek", { wins: data.wins7d, coins: fmt(data.paid7d) })}
      </p>

      {chartData.length >= 2 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {t("jackpotHistoryTitle")}
          </p>
          <TrendChart
            data={chartData}
            series={[
              { key: "mega", label: t("jackpotHistoryMega"), color: "#fbbf24" },
              { key: "total", label: t("jackpotHistoryTotal"), color: "#a970ff" },
            ]}
            ariaLabel={t("jackpotHistoryTitle")}
            height={140}
          />
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("jackpotHistoryHint")}</p>
      )}
      {snapshotStaleDays > 1 && (
        <p className="mt-1 text-xs text-warning">
          {t("jackpotHistoryStale", { n: snapshotStaleDays })}
        </p>
      )}
    </section>
  );
}
