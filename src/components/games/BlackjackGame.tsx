"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

export default function BlackjackGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("blackjack");
  const [stopAt, setStopAt] = useState(17);
  const [last, setLast] = useState<{
    playerCards: number[];
    dealerCards: number[];
    playerTotal: number;
    dealerTotal: number;
    outcome: string;
  } | null>(null);

  async function deal() {
    const result = await play({ stopAt });
    if (result) setLast(result.result as typeof last);
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={balance} />
      <GameError error={error} />
      <div className="card space-y-4 p-6">
        <label className="block text-center text-sm">
          <span className="text-muted">{t("stopAt")}: </span>
          <span className="font-bold">{stopAt}+</span>
          <input
            type="range"
            min={12}
            max={20}
            value={stopAt}
            onChange={(event) => setStopAt(Number(event.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
        </label>
        <button type="button" disabled={busy} onClick={deal} className="btn btn-primary w-full">
          {t("deal")}
        </button>
        {last && (
          <div className="grid grid-cols-2 gap-4 text-center text-sm">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted">
                {t("you")} ({last.playerTotal})
              </p>
              <div className="flex flex-wrap justify-center gap-1">
                {last.playerCards.map((card, index) => (
                  <span key={index} className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 font-black tabular-nums">
                    {card === 1 ? "A" : card}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted">
                {t("bot")} ({last.dealerTotal})
              </p>
              <div className="flex flex-wrap justify-center gap-1">
                {last.dealerCards.map((card, index) => (
                  <span key={index} className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 font-black tabular-nums">
                    {card === 1 ? "A" : card}
                  </span>
                ))}
              </div>
            </div>
            <p className={`col-span-2 text-lg font-extrabold ${last.outcome === "win" ? "text-success" : last.outcome === "push" ? "text-muted" : "text-danger"}`}>
              {last.outcome === "win" ? t("youWin") : last.outcome === "push" ? t("push") : t("youLose")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
