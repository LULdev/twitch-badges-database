"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

const ICONS: Record<string, string> = {
  rock: "M12 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5.2A3 3 0 0 0 9 17a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z",
  paper: "M6 3h9a2 2 0 0 1 2 2v9l-4 7H8a2 2 0 0 1-2-2V5a2 2 0 0 1 0-2z",
  scissors: "M6 4l6 8 6-8M6 20l6-8 6 8",
};

export default function RpsGame() {
  const { bet, setBet, busy, error, play, t } = useGame("rps");
  const [last, setLast] = useState<{ player: string; bot: string; tie: boolean; won: boolean } | null>(null);

  async function choose(choice: string) {
    const result = await play({ choice });
    if (result) setLast(result.result as typeof last);
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={null} />
      <GameError error={error} />
      <div className="grid grid-cols-3 gap-3">
        {["rock", "paper", "scissors"].map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={busy}
            onClick={() => choose(choice)}
            className="card card-interactive flex flex-col items-center gap-2 p-6 disabled:opacity-50"
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d={ICONS[choice]} />
            </svg>
            <span className="text-sm font-bold">{t(choice)}</span>
          </button>
        ))}
      </div>
      {last && (
        <div className="card p-5 text-center text-sm">
          <p className="font-semibold">
            {t("you")}: {t(last.player)} · {t("bot")}: {t(last.bot)}
          </p>
          <p className={`mt-1 text-lg font-extrabold ${last.tie ? "text-muted" : last.won ? "text-success" : "text-danger"}`}>
            {last.tie ? t("tie") : last.won ? t("youWin") : t("youLose")}
          </p>
        </div>
      )}
    </div>
  );
}
