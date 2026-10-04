import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";
import { daySeries } from "@/lib/stats";

export interface CoinFlowRow {
  created_at: string;
  coins_amount: number | null;
}

/**
 * Paged read of the viewer's logged coin rows for the card window.
 * PostgREST caps one response at the project's max-rows (1000 by default),
 * so this loops `.range()` pages ordered by the unique `id` until a short
 * page arrives — a heavy account would otherwise get silently truncated
 * and the earned/spent sums undercounted. Throws on the first query error
 * (callers decide whether that means an empty card).
 */
export async function fetchCoinRows(
  supabase: SupabaseClient,
  userId: string,
  since: Date,
): Promise<CoinFlowRow[]> {
  const rows: CoinFlowRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("activity_events")
      .select("id, created_at, coins_amount")
      .eq("user_id", userId)
      .not("coins_amount", "is", null)
      .neq("coins_amount", 0)
      .gte("created_at", since.toISOString())
      .order("id", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as unknown as CoinFlowRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

/** Start of the rendered 30-UTC-day window (today-29 at UTC midnight) — the
 *  exact window `daySeries` zero-fills, shared by the profile and stats
 *  call sites so their queries and the strip agree. */
export function coinFlowSince(): Date {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 29);
  return since;
}

/**
 * The profile's coin-flow card: earned / spent / net of the logged coin
 * movements over the last 30 UTC days, plus a signed daily bar strip. The
 * copy is honest about the source — it counts every ledger row (including
 * admin corrections, which never reach the public feed) and excludes only
 * what has no row at all: regular arcade rounds. Shared between the profile
 * page and the owner-only block on /stats; the caller supplies the raw rows
 * (fetched with the service-role client — user_id is not anon-readable since
 * the 0040 column grants) and a unique section id.
 */
export default async function CoinFlowCard({
  rows,
  id = "coin-flow",
}: {
  rows: CoinFlowRow[];
  id?: string;
}) {
  const t = await getTranslations("profile");
  const locale = await getLocale();

  // Bucket the coin events per UTC day (the today()/daySeries convention) for
  // the strip; the KPIs sum the raw rows by sign, so a day that moved coins
  // both ways counts gross in and gross out instead of collapsing to its day
  // net (net stays identical either way).
  const coinByDay = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.created_at).slice(0, 10);
    coinByDay.set(key, (coinByDay.get(key) ?? 0) + (row.coins_amount ?? 0));
  }
  const coinDays = daySeries(
    [...coinByDay].map(([day, coins]) => ({ day, coins })),
    30,
  );
  const coinEarned = rows.reduce(
    (sum, row) => sum + Math.max(0, row.coins_amount ?? 0),
    0,
  );
  const coinSpent = rows.reduce(
    (sum, row) => sum + Math.max(0, -(row.coins_amount ?? 0)),
    0,
  );
  const coinNet = coinEarned - coinSpent;
  const coinMax = Math.max(1, ...coinDays.map((d) => Math.abs(d.coins ?? 0)));

  return (
    <section className="card p-5" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-extrabold tracking-tight">
        {t("coinFlow")}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="bl-kpi">
          <b dir="ltr" className="text-success">
            {`+${coinEarned.toLocaleString(locale)}`}
          </b>
          <span>{t("coinFlowEarned")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr" className="text-danger">
            {`−${coinSpent.toLocaleString(locale)}`}
          </b>
          <span>{t("coinFlowSpent")}</span>
        </div>
        <div className="bl-kpi">
          <b dir="ltr" className={coinNet >= 0 ? "text-success" : "text-danger"}>
            {coinNet >= 0 ? "+" : "−"}
            {Math.abs(coinNet).toLocaleString(locale)}
          </b>
          <span>{t("coinFlowNet")}</span>
        </div>
      </div>
      {coinEarned + coinSpent > 0 ? (
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
          <p className="mt-2 text-xs text-muted">{t("coinFlowNote")}</p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("coinFlowEmpty")}</p>
      )}
    </section>
  );
}
