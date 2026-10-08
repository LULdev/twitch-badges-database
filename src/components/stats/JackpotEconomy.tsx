import { getLocale, getTranslations } from "next-intl/server";
import Coin from "@/components/Coin";
import type { JackpotEconomyData } from "@/lib/stats";

/**
 * Public economy card on /stats: the progressive-jackpot aggregates from the
 * stats_jackpot_economy view (0070) — live pots, all-time contributions and
 * payouts, the biggest win, the 7-day win activity. Aggregates only, no
 * per-user data; the tile markup mirrors CommunityCoinFlow deliberately
 * (same bl-kpi tiles, only the strings and the data source differ).
 */
export default async function JackpotEconomy({
  data,
  id = "jackpot-economy",
}: {
  data: JackpotEconomyData;
  id?: string;
}) {
  const t = await getTranslations("stats");
  const locale = await getLocale();
  const fmt = (value: number) => value.toLocaleString(locale);

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
    </section>
  );
}
