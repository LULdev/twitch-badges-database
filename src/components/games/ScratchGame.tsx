"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { useGame, BetBar, GameError } from "./useGame";
import Coin from "@/components/Coin";
import CeremonyCoin from "@/components/items/CeremonyCoin";

/**
 * Twitch brand and event names — deliberately identical (Latin) in every locale,
 * because that is what players read on Twitch itself. The two common nouns among
 * the symbols (`founder`, `jackpot`) go through t().
 */
const BRANDS: Record<string, string> = {
  premium: "Prime",
  turbo: "Turbo",
  bits: "Bits",
  subtember: "SUBtember",
  wsci: "WSCI",
};

/** Scaffolding for proving the jackpot ceremony without a 1-in-12,500 card
 *  (the wheel's CEREMONY_PREVIEW precedent). Seeds five jackpot cells and
 *  reveals them so the ★ faces and the ceremony render deterministically. */
const CEREMONY_PREVIEW = false;

export default function ScratchGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("scratch");
  const locale = useLocale();
  const [cells, setCells] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState<boolean[]>(Array(9).fill(false));
  // The card's outcome, kept client-side for the verdict line and the
  // jackpot ceremony (the server already emits mult/jackpot — previously
  // discarded, so the game showed no payout at all).
  const [lastCard, setLastCard] = useState<{ payout: number; bet: number; mult: number; jackpot: boolean } | null>(null);

  async function newCard() {
    setLastCard(null);
    const result = await play({});
    if (!result) return;
    const r = result.result as { cells: string[]; mult?: number; jackpot?: boolean };
    setCells(r.cells);
    setRevealed(Array(9).fill(false));
    setLastCard({
      payout: result.payout,
      bet: result.bet,
      mult: Number(r.mult ?? 0),
      jackpot: Boolean(r.jackpot),
    });
  }

  // Ceremony proof seeding — see CEREMONY_PREVIEW above.
  useEffect(() => {
    if (!CEREMONY_PREVIEW) return;
    const timer = setTimeout(() => {
      setCells(["jackpot", "jackpot", "jackpot", "jackpot", "jackpot", "premium", "turbo", "bits", "founder"]);
      setRevealed(Array(9).fill(true));
      setLastCard({ payout: 10000, bet: 1000, mult: 10, jackpot: true });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={1000} busy={busy} balance={balance} />
      <GameError error={error} />
      <div className="card space-y-4 p-6">
        <div className="mx-auto grid max-w-sm grid-cols-3 gap-2">
          {(cells ?? (Array(9).fill(null) as unknown[])).map((cell, index) => (
            <button
              key={index}
              type="button"
              onClick={() =>
                setRevealed((prev) => {
                  const next = [...prev];
                  next[index] = true;
                  return next;
                })
              }
              className={`grid aspect-square place-items-center rounded-xl border text-xs font-black transition-all ${
                revealed[index] && cell
                  ? cell === "jackpot"
                    ? "border-warning bg-warning/15 text-warning"
                    : "border-accent bg-accent-soft text-foreground"
                  : "border-line bg-surface-3 text-muted"
              }`}
            >
              {revealed[index] && cell ? (
                cell === "jackpot" ? (
                  <>
                    <span aria-hidden>★ </span>
                    {t("scratchJackpot")}
                    <span aria-hidden> ★</span>
                  </>
                ) : cell === "founder" ? (
                  t("scratchFounder")
                ) : (
                  (BRANDS[String(cell)] ?? String(cell))
                )
              ) : (
                "?"
              )}
            </button>
          ))}
        </div>
        {/* Verdict line (new — the card previously showed no payout) with the
            jackpot ceremony: the coin stamps in the moment the first jackpot
            cell is scratched, so the reveal and the ritual land together.
            A 0.7x three-of-a-kind returns LESS than the stake — that renders
            neutrally (return, not a signed win), or it would print "+-3". */}
        {lastCard && lastCard.payout > 0 && (
          <p
            className={`text-center text-lg font-extrabold ${
              lastCard.payout > lastCard.bet ? "text-success" : "text-muted"
            }`}
          >
            {lastCard.payout > lastCard.bet ? (
              <span dir="ltr" className="inline-flex items-center gap-1.5">
                {`+${(lastCard.payout - lastCard.bet).toLocaleString(locale)}`} <Coin size={14} />
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span dir="ltr">{lastCard.payout.toLocaleString(locale)}</span> <Coin size={14} />
              </span>
            )}
            {lastCard.mult > 0 ? ` — ${lastCard.mult}x` : ""}
          </p>
        )}
        {lastCard?.jackpot && revealed.some((r, i) => r && cells?.[i] === "jackpot") && (
          <div className="text-center">
            <CeremonyCoin />
          </div>
        )}
        <button type="button" disabled={busy} onClick={newCard} className="btn btn-primary w-full">
          {t("newCard")}
        </button>
        <p className="text-center text-xs text-muted">{t("scratchHint")}</p>
      </div>
    </div>
  );
}
