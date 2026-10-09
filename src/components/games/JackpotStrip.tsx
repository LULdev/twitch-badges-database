import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Coin from "@/components/Coin";
import { GAME_COLORS } from "@/components/games/GameArt";
import type { JackpotPot, JackpotWinEntry } from "@/lib/queries";
import { GAMES } from "@/lib/gamification/games";
import JackpotPotsLive from "@/components/games/JackpotPotsLive";

/**
 * The progressive-jackpot strip on the games hub (0069): the global Mega pot
 * as the headline number, every game pot as a live chip, the newest winners
 * and the biggest winners of all time as full-width rows beneath. Server-
 * rendered from the public tables — a snapshot, deliberately: the pots tick
 * in real time on the game pages (every round response carries the fresh
 * values), while the hub re-reads on every visit.
 */
export default async function JackpotStrip({
  jackpots,
  wins,
  hallOfFame,
  locale,
}: {
  jackpots: JackpotPot[];
  wins: JackpotWinEntry[];
  hallOfFame: JackpotWinEntry[];
  locale: string;
}) {
  const t = await getTranslations("games");
  const mega = jackpots.find((j) => j.kind === "mega");
  if (!mega) return null;

  // The house short-date pattern (game page / BestRoundsCard).
  const winDate = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
  // The live component needs only the pot fields — the winners rows below
  // stay server-rendered (they change with a hit, not with a tick).
  const livePots = jackpots.map((pot) => ({
    scope: pot.scope,
    kind: pot.kind,
    pot: pot.pot,
    last_won_at: pot.last_won_at,
    last_winner: pot.last_winner,
    last_win_amount: pot.last_win_amount,
  }));
  // Hall-of-fame medal tints — the .rank-row podium tokens (dark + light).
  const medals = ["var(--rank-gold)", "var(--rank-silver)", "var(--rank-bronze)"];
  const scopeLabel = (win: JackpotWinEntry) =>
    win.kind === "mega"
      ? t("jackpotMegaTitle")
      : win.scope in GAME_COLORS
        ? t(`${win.scope}Title`)
        : win.scope;

  return (
    <section className="card jackpot-strip" aria-labelledby="jackpot-head">
      {/* The live half — Mega headline, last-winner line, per-game chips —
          rendered from the server snapshot, then polled every 15s so the
          pots tick between page loads (display:contents keeps the strip's
          flex layout untouched). */}
      <JackpotPotsLive initialJackpots={livePots} gameOrder={GAMES.map((meta) => meta.id)} />

      {wins.length > 0 && (
        <div className="jackpot-winners">
          <span className="jackpot-winners-label">
            <span
              className="size-2 rounded-full"
              style={{ background: "var(--warning)" }}
              aria-hidden="true"
            />
            {t("jackpotWinners")}
          </span>
          {wins.map((win) => (
            <span key={win.id} className="jackpot-winner">
              <span
                className="size-2 rounded-full"
                style={{
                  background:
                    win.kind === "mega"
                      ? "var(--rank-gold)"
                      : (GAME_COLORS[win.scope] ?? "var(--accent)"),
                }}
                aria-hidden="true"
              />
              {win.username ? (
                <Link href={`/profile/${win.username}`} className="font-bold hover:text-accent">
                  {win.username}
                </Link>
              ) : null}
                <span className="text-xs text-muted">
                  {scopeLabel(win)}
                </span>
                <span
                  dir="ltr"
                  className="inline-flex items-center gap-1 font-bold text-success tabular-nums"
                >
                  +{win.amount.toLocaleString(locale)} <Coin size={11} />
                </span>
              </span>
            ))}
          </div>
        )}

        {hallOfFame.length > 0 && (
          // All-time records, distinct from the recency row above: the three
          // BIGGEST wins ever with a podium-medal rank. Hidden until the
          // first hit, like every other jackpot surface.
          <div className="jackpot-hof">
            <span className="jackpot-winners-label">
              <span
                className="size-2 rounded-full"
                style={{ background: "var(--rank-gold)" }}
                aria-hidden="true"
              />
              {t("jackpotHofTitle")}
            </span>
            {hallOfFame.map((win, index) => (
              <span key={win.id} className="jackpot-winner">
                <span
                  className="jackpot-hof-rank"
                  style={{ color: medals[index] ?? "var(--muted)" }}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                {win.username ? (
                  <Link href={`/profile/${win.username}`} className="font-bold hover:text-accent">
                    {win.username}
                  </Link>
                ) : null}
                <span className="text-xs text-muted">{scopeLabel(win)}</span>
                <span
                  dir="ltr"
                  className="inline-flex items-center gap-1 font-bold text-success tabular-nums"
                >
                  +{win.amount.toLocaleString(locale)} <Coin size={11} />
                </span>
                <time dateTime={win.created_at} className="text-xs text-muted">
                  {winDate.format(new Date(win.created_at))}
                </time>
              </span>
            ))}
          </div>
        )}
      </section>
    );
}
