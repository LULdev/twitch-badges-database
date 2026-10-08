import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Coin from "@/components/Coin";
import CountUp from "@/components/stats/CountUp";
import { GAME_COLORS } from "@/components/games/GameArt";
import type { JackpotPot, JackpotWinEntry } from "@/lib/queries";
import { GAMES } from "@/lib/gamification/games";

/**
 * The progressive-jackpot strip on the games hub (0069): the global Mega pot
 * as the headline number, every game pot as a live chip, and the newest
 * winners as a row beneath. Server-rendered from the public tables — a
 * snapshot, deliberately: the pots tick in real time on the game pages
 * (every round response carries the fresh values), while the hub re-reads on
 * every visit.
 */
export default async function JackpotStrip({
  jackpots,
  wins,
  locale,
}: {
  jackpots: JackpotPot[];
  wins: JackpotWinEntry[];
  locale: string;
}) {
  const t = await getTranslations("games");
  const mega = jackpots.find((j) => j.kind === "mega");
  if (!mega) return null;
  const gamePots = jackpots.filter((j) => j.kind === "game");
  // GAMES order (hub tile order), not the alphabetical table order.
  const ordered = GAMES.flatMap((meta) => {
    const pot = gamePots.find((j) => j.scope === meta.id);
    return pot ? [pot] : [];
  });

  return (
    <section className="card jackpot-strip" aria-labelledby="jackpot-head">
      <div className="jackpot-mega">
        <span className="jackpot-crown" aria-hidden="true">
          {/* Trophy — the one jackpot glyph, inline SVG per house style. */}
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
          </svg>
        </span>
        <div className="jackpot-mega-body">
          <h2 id="jackpot-head" className="jackpot-label">
            {t("jackpotMegaTitle")}
          </h2>
          <p className="jackpot-amount" dir="ltr">
            <CountUp value={mega.pot} locale={locale} />{" "}
            <Coin size={20} variant="b" className="bcoin-lg" />
          </p>
          <p className="jackpot-last">
            {mega.last_winner
              ? t("jackpotLastWin", {
                  name: mega.last_winner,
                  n: mega.last_win_amount ?? 0,
                })
              : t("jackpotNobodyYet")}
          </p>
        </div>
      </div>

      <div className="jackpot-games">
        {ordered.map((pot) => (
          <Link
            key={pot.scope}
            href={`/games/${pot.scope}`}
            className="jackpot-chip"
            style={{ ["--gg-color" as string]: GAME_COLORS[pot.scope] ?? "var(--accent)" }}
          >
            <span className="jackpot-chip-dot" aria-hidden="true" />
            <span className="jackpot-chip-name">{t(`${pot.scope}Title`)}</span>
            <span className="jackpot-chip-pot" dir="ltr">
              {pot.pot.toLocaleString(locale)} <Coin size={11} />
            </span>
          </Link>
        ))}
      </div>

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
                {win.kind === "mega"
                  ? t("jackpotMegaTitle")
                  : win.scope in GAME_COLORS
                    ? t(`${win.scope}Title`)
                    : win.scope}
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
    </section>
  );
}
