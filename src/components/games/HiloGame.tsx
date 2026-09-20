"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

export default function HiloGame() {
  const { bet, setBet, busy, error, play, t } = useGame("hilo");
  const [state, setState] = useState<{
    currentScore: number;
    actual?: string;
    won?: boolean;
  }>({ currentScore: 30 });

  async function guess(choice: "higher" | "lower") {
    const result = await play({ choice });
    if (!result) return;
    const r = result.result as {
      currentScore: number;
      nextScore: number;
      actual: string;
      won: boolean;
    };
    setState({ currentScore: r.nextScore, actual: r.actual, won: r.won });
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={null} />
      <GameError error={error} />
      <div className="card space-y-4 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          {t("currentRarity")}
        </p>
        <p className="text-5xl font-black tabular-nums">{state.currentScore}</p>
        {state.actual && (
          <p className={`text-sm font-bold ${state.won ? "text-success" : "text-danger"}`}>
            {state.won ? t("youWin") : t("youLose")} ({state.actual})
          </p>
        )}
        <div className="flex justify-center gap-3">
          <button type="button" disabled={busy} onClick={() => guess("higher")} className="btn btn-primary px-8">
            ▲ {t("higher")}
          </button>
          <button type="button" disabled={busy} onClick={() => guess("lower")} className="btn btn-secondary px-8">
            ▼ {t("lower")}
          </button>
        </div>
        <p className="text-xs text-muted">{t("hiloHint")}</p>
      </div>
    </div>
  );
}
