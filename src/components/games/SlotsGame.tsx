"use client";

import { useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";
import Coin from "@/components/Coin";

interface Symbol {
  id: string;
  label: string;
  image: string | null;
}

/** Badges of Ra 6 Deluxe — 5 reels × 3 rows, real Twitch badge symbols. */
export default function SlotsGame() {
  const { bet, setBet, busy, error, play, t } = useGame("slots");
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [reels, setReels] = useState<string[][]>(
    Array.from({ length: 3 }, () => Array(5).fill("")),
  );
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState<{ payout: number; lines: number; scatter: number } | null>(null);
  const spinTimer = useRef<number>(0);

  useEffect(() => {
    fetch("/api/games/symbols")
      .then((res) => res.json())
      .then((data: { symbols: Symbol[] }) => setSymbols(data.symbols ?? []))
      .catch(() => undefined);
    return () => window.clearInterval(spinTimer.current);
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
    setLastWin({ payout: result.payout, lines: r.lineWins?.length ?? 0, scatter: r.scatter });
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
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy || spinning} balance={null} />
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
            {spinning ? t("spinning") : (<span>{t("spin")} (<span className="inline-flex items-center gap-1">{bet.toLocaleString("en")} <Coin size={14} /></span>)</span>)}
          </button>
          {lastWin && (
            <p className={`mt-3 text-center text-lg font-extrabold ${lastWin.payout > bet ? "text-success" : "text-muted"}`}>
              {lastWin.payout > bet
                ? (<span>+{(lastWin.payout - bet).toLocaleString("en")} <Coin size={14} /> — {lastWin.lines} {t("paylines")}{lastWin.scatter >= 3 ? ` · ${lastWin.scatter}x SCATTER!` : ""}</span>)
                : t("noWin")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
