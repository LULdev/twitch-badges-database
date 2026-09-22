"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";
import Coin from "@/components/Coin";

export default function TowerGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("tower");
  const [cashoutAt, setCashoutAt] = useState(5);
  const [last, setLast] = useState<{ floor: number; survived: boolean; payout: number } | null>(null);

  async function climb() {
    const res = await play({ cashoutAt });
    if (!res) return;
    // The server result is untyped coming over the wire: read only the fields
    // that are actually present instead of casting the whole object.
    const raw = res.result as Record<string, unknown>;
    setLast({
      floor: typeof raw.floor === "number" ? raw.floor : 0,
      survived: raw.survived === true,
      payout: res.payout,
    });
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <div className="card space-y-4 p-6">
        <div className="mx-auto flex max-w-xs flex-col-reverse gap-1">
          {Array.from({ length: 10 }, (_, index) => {
            const floor = index + 1;
            const reached = last ? floor <= last.floor : floor <= cashoutAt;
            const survived = last ? last.survived : true;
            const isCashout = floor === cashoutAt;
            return (
              <div
                key={floor}
                className={`flex items-center justify-between rounded-lg border px-4 py-1.5 text-xs font-bold ${
                  isCashout ? "border-accent" : "border-line"
                } ${
                  reached
                    ? survived
                      ? "bg-success/15 text-success"
                      : "bg-danger/15 text-danger"
                    : "bg-surface-2 text-muted"
                }`}
              >
                <span>
                  {t("floor")} {floor}
                </span>
                <span>{isCashout ? `← ${t("cashout")}` : `×${(1 + floor * 0.22).toFixed(2)}`}</span>
              </div>
            );
          })}
        </div>
        <label className="block text-center text-sm">
          <span className="text-muted">{t("cashoutAt")}: </span>
          <span className="font-bold">{cashoutAt}</span>
          <input
            type="range"
            min={1}
            max={10}
            value={cashoutAt}
            onChange={(event) => setCashoutAt(Number(event.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
        </label>
        <button type="button" disabled={busy} onClick={climb} className="btn btn-primary w-full">
          {t("climb")}
        </button>
        {last && (
          <p className={`text-center text-lg font-extrabold ${last.survived ? "text-success" : "text-danger"}`}>
            {last.survived ? t("youWin") : t("crashed")} (<span className="inline-flex items-center gap-1">{last.payout.toLocaleString("en")} <Coin size={14} /></span>)
          </p>
        )}
      </div>
    </div>
  );
}
