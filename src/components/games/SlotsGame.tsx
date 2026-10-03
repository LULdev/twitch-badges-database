"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useGame, BetBar, GameError } from "./useGame";
import Coin from "@/components/Coin";
import CeremonyCoin from "@/components/items/CeremonyCoin";

interface Symbol {
  id: string;
  label: string;
  image: string | null;
}

/** Scaffolding for proving the big-win ceremony without a real jackpot
 *  (flip true, mount temporarily, screenshot, revert — the wheel's
 *  CEREMONY_PREVIEW precedent). Seeds a capped 25x win so the verdict and
 *  the ceremony coin render deterministically. */
const CEREMONY_PREVIEW = false;

/** Badges of Ra 6 Deluxe — 5 reels × 3 rows, real Twitch badge symbols. */
export default function SlotsGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("slots");
  const locale = useLocale();
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [reels, setReels] = useState<string[][]>(
    Array.from({ length: 3 }, () => Array(5).fill("")),
  );
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState<{ payout: number; bet: number; lines: number; scatter: number; record?: boolean } | null>(null);
  const spinTimer = useRef<number>(0);

  useEffect(() => {
    fetch("/api/games/symbols")
      .then((res) => res.json())
      .then((data: { symbols: Symbol[] }) => setSymbols(data.symbols ?? []))
      .catch(() => undefined);
    return () => window.clearInterval(spinTimer.current);
  }, []);

  // Ceremony proof seeding — see CEREMONY_PREVIEW above.
  useEffect(() => {
    if (!CEREMONY_PREVIEW) return;
    const timer = setTimeout(() => {
      setReels([
        ["premium-v1", "premium-v1", "premium-v1", "premium-v1", "premium-v1"],
        ["turbo-v1", "bits-v1", "founder-v1", "subtember-2026-v1", "wsci-2026-v1"],
        ["scatter", "premium-v1", "turbo-v1", "bits-v1", "founder-v1"],
      ]);
      setLastWin({ payout: 50000, bet: 2000, lines: 1, scatter: 0 });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const symbolById = new Map(symbols.map((s) => [s.id, s]));

  async function spin() {
    if (spinning) return;
    setSpinning(true);
    setLastWin(null);
    spinTimer.current = window.setInterval(() => {
      setReels(
        Array.from({ length: 3 }, () =>
          Array.from({ length: 5 }, () => symbols.length ? symbols[Math.floor(Math.random() * symbols.length)].id : ""),
        ),
      );
    }, 90);

    const result = await play({});
    window.clearInterval(spinTimer.current);
    setSpinning(false);
    if (!result) return;
    const r = result.result as {
      reels: string[][];
      lineWins: Array<{ line: number }>;
      scatter: number;
    };
    setReels(r.reels);
    setLastWin({ payout: result.payout, bet, lines: r.lineWins?.length ?? 0, scatter: r.scatter, record: result.result.newPersonalBest === true });
  }

  function renderSymbol(id: string) {
    const symbol = symbolById.get(id);
    if (!symbol) return null;
    if (symbol.image) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={symbol.image} alt={symbol.label} width={44} height={44} className={id === "scatter" ? "opacity-90" : ""} />;
    }
    return <span className="text-[0.625rem] font-black">RA</span>;
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy || spinning} balance={balance} />
      <GameError error={error} />
      <div className="card overflow-hidden">
        <div className="border-b border-line bg-surface-2 px-4 py-2 text-center text-xs font-black uppercase tracking-[0.2em] text-warning">
          Badges of Ra <span className="text-accent">6</span> Deluxe
        </div>
        <div className="grid grid-cols-5 gap-1.5 p-4">
          {reels.map((row, rowIndex) =>
            row.map((symbolId, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`grid aspect-square place-items-center rounded-lg border ${
                  symbolId === "scatter"
                    ? "border-warning/60 bg-warning/10"
                    : "border-line bg-surface-2"
                } ${spinning ? "animate-pulse" : ""}`}
              >
                {renderSymbol(symbolId)}
              </div>
            )),
          )}
        </div>
        <div className="border-t border-line p-4">
          <button
            type="button"
            disabled={busy || spinning || symbols.length === 0}
            onClick={spin}
            className="btn btn-primary w-full py-3 text-base"
          >
            {spinning ? t("spinning") : (<span>{t("spin")} (<span className="inline-flex items-center gap-1">{bet.toLocaleString(locale)} <Coin size={14} /></span>)</span>)}
          </button>
          {lastWin && (
            <>
              <p className={`mt-3 text-center text-lg font-extrabold ${lastWin.payout > lastWin.bet ? "text-success" : "text-muted"}`}>
                {lastWin.payout > lastWin.bet
                  ? (<span><span dir="ltr">{`+${(lastWin.payout - lastWin.bet).toLocaleString(locale)}`}</span> <Coin size={14} /> — {lastWin.lines} {t("paylines")}{lastWin.scatter >= 3 ? ` · ${lastWin.scatter}x ${t("scatter")}` : ""}</span>)
                  : t("noWin")}
              </p>
              {/* Big win (>=15x the stake: five-scatter tier, multi-premium
                  lines or the 25x cap — scatter-3/4 tiers stay below): the
                  shared ceremony coin stamps in. Gated on lastWin only, so
                  it never mounts mid-spin; lastWin nulls on every spin, so
                  consecutive big wins re-trigger the stamp. */}
              {lastWin.payout >= lastWin.bet * 15 && (
                <div className="mt-1 text-center">
                  <CeremonyCoin />
                </div>
              )}
              {lastWin.record ? (
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-bold text-warning">
                  <Coin variant="b" size={14} className="bcoin-lg" />
                  {t("newPersonalBest")}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
