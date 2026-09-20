"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

export default function RouletteGame() {
  const { bet, setBet, busy, error, play, t } = useGame("roulette");
  const [history, setHistory] = useState<Array<{ number: number; color: string; won: boolean }>>([]);

  async function pick(choice: string) {
    const result = await play({ choice });
    if (!result) return;
    const r = result.result as { number: number; color: string; won: boolean };
    setHistory((prev) => [{ number: r.number, color: r.color, won: r.won }, ...prev].slice(0, 12));
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={null} />
      <GameError error={error} />
      <div className="card space-y-5 p-6">
        <div className="flex justify-center gap-3">
          <button type="button" disabled={busy} onClick={() => pick("red")} className="btn w-28 border-danger/50 bg-danger/20 text-danger">
            {t("red")} 2×
          </button>
          <button type="button" disabled={busy} onClick={() => pick("green")} className="btn w-28 border-success/50 bg-success/20 text-success">
            {t("green")} 14×
          </button>
          <button type="button" disabled={busy} onClick={() => pick("black")} className="btn w-28 border-line bg-surface-3">
            {t("black")} 2×
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {history.map((entry, index) => (
            <span
              key={index}
              className={`grid size-9 place-items-center rounded-full border text-xs font-black tabular-nums ${
                entry.color === "red"
                  ? "border-danger bg-danger/25 text-danger"
                  : entry.color === "green"
                    ? "border-success bg-success/25 text-success"
                    : "border-line bg-surface-3"
              } ${entry.won ? "ring-2 ring-accent" : ""}`}
            >
              {entry.number}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
