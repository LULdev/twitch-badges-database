"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Coin from "@/components/Coin";
import { Link } from "@/i18n/navigation";
import { GAME_COLORS } from "@/components/games/GameArt";

/**
 * The live-pot half of the hub strip (0069): the Mega headline (with the
 * dated last-winner line) and the per-game chips, polled from /api/jackpots
 * so the pots tick BETWEEN page loads too — the server-rendered page is a
 * snapshot, this makes the growth visible while you watch.
 *
 * `.jackpot-live` is display:contents, so its children participate in the
 * strip's flex layout exactly as they did when this was one server tree.
 * Poll cadence: 15s, visibility-gated (the LiveStatus convention); the first
 * poll fires only AFTER one interval, so the SSR snapshot is the paint and a
 * failed poll keeps the last known pots.
 */

interface LivePot {
  scope: string;
  kind: "mega" | "game";
  pot: number;
  last_won_at: string | null;
  last_winner: string | null;
  last_win_amount: number | null;
}

const POLL_MS = 15_000;

export default function JackpotPotsLive({
  initialJackpots,
  gameOrder,
}: {
  /** Server-read snapshot — the first paint, and the fallback on poll failure. */
  initialJackpots: LivePot[];
  /** Game ids in hub-tile order — passed as a prop because GAMES itself lives
   *  in the server-side game engine (importing it here would pull the
   *  service-role client into the browser bundle). */
  gameOrder: string[];
}) {
  const t = useTranslations("games");
  const locale = useLocale();
  const [jackpots, setJackpots] = useState<LivePot[]>(initialJackpots);
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/jackpots", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jackpots?: LivePot[] };
      if (mounted.current && Array.isArray(data.jackpots) && data.jackpots.length > 0) {
        setJackpots(data.jackpots);
      }
    } catch {
      // A failed poll keeps the last known pots — the next one retries.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [poll]);

  const mega = jackpots.find((j) => j.kind === "mega") ?? null;
  const gamePots = jackpots.filter((j) => j.kind === "game");
  // Hub-tile order, from the server prop.
  const ordered = gameOrder.flatMap((id) => {
    const pot = gamePots.find((j) => j.scope === id);
    return pot ? [pot] : [];
  });
  const winDate = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });

  return (
    <div className="jackpot-live">
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
          {mega && (
            <p className="jackpot-amount" dir="ltr">
              {mega.pot.toLocaleString(locale)}{" "}
              <Coin size={20} variant="b" className="bcoin-lg" />
            </p>
          )}
          <p className="jackpot-last">
            {mega?.last_winner
              ? t("jackpotLastWin", {
                  name: mega.last_winner,
                  n: mega.last_win_amount ?? 0,
                })
              : t("jackpotNobodyYet")}
            {mega?.last_winner && mega.last_won_at ? (
              <>
                {" · "}
                <time dateTime={mega.last_won_at}>
                  {winDate.format(new Date(mega.last_won_at))}
                </time>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="jackpot-games">
        {ordered.map((pot) => (
          <Link
            key={pot.scope}
            href={`/games/${pot.scope}`}
            className="jackpot-chip"
            title={
              pot.last_winner && pot.last_won_at
                ? t("jackpotChipLast", {
                    name: pot.last_winner,
                    n: pot.last_win_amount ?? 0,
                    date: winDate.format(new Date(pot.last_won_at)),
                  })
                : undefined
            }
            style={{ ["--gg-color" as string]: GAME_COLORS[pot.scope] ?? "var(--accent)" }}
          >
            <span className="jackpot-chip-dot" aria-hidden="true" />
            <span className="jackpot-chip-name">{t(`${pot.scope}Title`)}</span>
            {pot.last_winner && <span className="jackpot-chip-won" aria-hidden="true" />}
            <span className="jackpot-chip-pot" dir="ltr">
              {pot.pot.toLocaleString(locale)} <Coin size={11} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
