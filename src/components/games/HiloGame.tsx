"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

export default function HiloGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("hilo");
  // The score is server-owned: it carries over between rounds, and on the very
  // first round the server rolls its own starting value (30–69). Showing a
  // client-side 30 before the first guess claimed a score the server had never
  // used, so the number starts empty and is filled from the server's reply.
  const [state, setState] = useState<{
    currentScore: number | null;
    actual?: string;
    won?: boolean;
    tie?: boolean;
  }>({ currentScore: null });

  async function guess(choice: "higher" | "lower") {
    const result = await play({ choice });
    if (!result) return;
    const r = result.result as {
      currentScore: number;
      nextScore: number;
      actual: string;
      won: boolean;
      tie?: boolean;
    };
    setState({
      currentScore: r.nextScore,
      actual: r.actual,
      won: r.won,
      tie: r.tie,
    });
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={balance} />
      <GameError error={error} />
      <div className="card space-y-4 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          {t("currentRarity")}
        </p>
        <p className="text-5xl font-black tabular-nums" aria-live="polite">
          {state.currentScore ?? "—"}
        </p>
        {state.actual && (
          <p
            className={`text-sm font-bold ${
              state.tie ? "text-warning" : state.won ? "text-success" : "text-danger"
            }`}
          >
            {state.tie ? t("tie") : state.won ? t("youWin") : t("youLose")}{" "}
            ({state.actual === "higher" ? t("higher") : state.actual === "lower" ? t("lower") : t("tie")})
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
