import { getLocale, getTranslations } from "next-intl/server";
import { daySeries, type CommunityCoinFlowData } from "@/lib/stats";

/**
 * Public economy card on /stats: the whole community's feed-logged coin
 * movement over the last 30 UTC days, from the aggregated view
 * stats_coin_flow_daily (0054 — aggregates only, no personal data). Markup
 * mirrors the profile's CoinFlowCard deliberately: same bl-kpi tiles, same
 * coin-flow-bars strip; only the strings and the data source differ.
 */
export default async function CommunityCoinFlow({
  data,
  id = "community-coin-flow",
}: {
  data: CommunityCoinFlowData;
  id?: string;
}) {
  const t = await getTranslations("stats");
  const locale = await getLocale();

  const coinByDay = new Map(data.days.map((day) => [day.day, day.net]));
  const coinDays = daySeries(
    [...coinByDay].map(([day, coins]) => ({ day, coins })),
    30,
  );
  const coinMax = Math.max(1, ...coinDays.map((d) => Math.abs(d.coins ?? 0)));

  return (
    <section className="card p-5" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-extrabold tracking-tight">
        {t("communityCoinTitle")}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="bl-kpi">
          <b dir="ltr" className="text-success">
            {`+${data.earned.toLocaleString(locale)}`}
          </b>
          <span>{t("communityCoinEarned")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr" className="text-danger">
            {`−${data.spent.toLocaleString(locale)}`}
          </b>
          <span>{t("communityCoinSpent")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr" className={data.net >= 0 ? "text-success" : "text-danger"}>
            {data.net >= 0 ? "+" : "−"}
            {Math.abs(data.net).toLocaleString(locale)}
          </b>
          <span>{t("communityCoinNet")}</span>
        </div>
      </div>
      {data.earned + data.spent > 0 ? (
        <>
          <div className="coin-flow-bars mt-3" aria-hidden="true">
            {coinDays.map((d) => {
              const v = d.coins ?? 0;
              const pct =
                v === 0 ? 0 : Math.max(8, Math.round((Math.abs(v) / coinMax) * 100));
              return (
                <span
                  key={d.day}
                  className="coin-flow-bar"
                  data-dir={v > 0 ? "in" : v < 0 ? "out" : undefined}
                  style={{ height: `${pct}%` }}
                  title={`${d.label} ${v === 0 ? "·" : `${v > 0 ? "+" : "−"}${Math.abs(v).toLocaleString(locale)}`}`}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">{t("communityCoinNote")}</p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("communityCoinEmpty")}</p>
      )}
    </section>
  );
}
