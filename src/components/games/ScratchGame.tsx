"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

const LABELS: Record<string, string> = {
  premium: "Prime",
  turbo: "Turbo",
  bits: "Bits",
  founder: "Founder",
  subtember: "SUBtember",
  wsci: "WSCI",
  jackpot: "★ JACKPOT ★",
};

export default function ScratchGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("scratch");
  const [cells, setCells] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState<boolean[]>(Array(9).fill(false));

  async function newCard() {
    const result = await play({});
    if (!result) return;
    setCells(result.result.cells as string[]);
    setRevealed(Array(9).fill(false));
  }

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
              {revealed[index] && cell ? (LABELS[String(cell)] ?? String(cell)) : "?"}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={newCard} className="btn btn-primary w-full">
          {t("newCard")}
        </button>
        <p className="text-center text-xs text-muted">{t("scratchHint")}</p>
      </div>
    </div>
  );
}
