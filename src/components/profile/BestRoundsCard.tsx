import { getLocale, getTranslations } from "next-intl/server";
import { GAME_COLORS } from "@/components/games/GameArt";
import Coin from "@/components/Coin";

export interface BestRoundRow {
  game: string;
  best_net: number | null;
  rounds: number | null;
}

export interface RecordHistoryEntry {
  out_created_at: string;
  out_game: string;
  out_net: number | null;
}

/**
 * The owner's best single-round net per played game, from the aggregate view
 * stats_player_best_rounds (0055), plus the recent record-break history from
 * the player_record_history RPC (0056) when the caller supplies it.
 * Presentational — the caller supplies the rows (same contract as
 * CoinFlowCard). Rendered only for the own profile; hidden entirely while the
 * player has not settled a single round.
 */
export default async function BestRoundsCard({
  rows,
  history = [],
  id = "best-rounds",
}: {
  rows: BestRoundRow[];
  history?: RecordHistoryEntry[];
  id?: string;
}) {
  const t = await getTranslations("profile");
  const tGames = await getTranslations("games");
  const locale = await getLocale();
  const historyDate = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });

  return (
    <section className="card p-5" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-extrabold tracking-tight">
        {t("bestRoundsTitle")}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {rows.map((row) => (
          <li key={row.game} className="chip flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ background: GAME_COLORS[row.game] ?? "var(--accent)" }}
              aria-hidden
            />
            {tGames(`${row.game}Title`)}
            <span
              dir="ltr"
              className="inline-flex items-center gap-1 font-bold text-success"
            >
              +{(row.best_net ?? 0).toLocaleString(locale)} <Coin size={11} />
            </span>
            <span className="text-muted">· {row.rounds ?? 0}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t("bestRoundsNote")}</p>
      {history.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("recordHistoryTitle")}
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {history.map((entry, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2">
                <span
                  dir="ltr"
                  className="inline-flex items-center gap-1 font-bold text-success"
                >
                  +{(entry.out_net ?? 0).toLocaleString(locale)} <Coin size={11} />
                </span>
                <span>{tGames(`${entry.out_game}Title`)}</span>
                <time
                  dateTime={entry.out_created_at}
                  className="ms-auto text-xs text-muted"
                >
                  {historyDate.format(new Date(entry.out_created_at))}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
