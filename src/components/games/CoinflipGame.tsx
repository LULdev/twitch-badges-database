"use client";

import { useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

export default function CoinflipGame() {
  const { bet, setBet, busy, error, play, t } = useGame("coinflip");
  const [side, setSide] = useState<"heads" | "tails">("heads");
  const [target, setTarget] = useState(3);
  const [flips, setFlips] = useState<string[] | null>(null);

  async function go() {
    const result = await play({ choice: side, target });
    if (result) setFlips((result.result.flips as string[]) ?? []);
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={null} />
      <GameError error={error} />
      <div className="card space-y-4 p-5">
        <div className="flex justify-center gap-2">
          {(["heads", "tails"] as const).map((option) => (
            <button key={option} type="button" onClick={() => setSide(option)} className={`chip ${side === option ? "chip-active" : ""}`}>
              {t(option)}
            </button>
          ))}
        </div>
        <label className="block text-center text-sm">
          <span className="text-muted">{t("ladderTarget")}: </span>
          <span className="font-bold">
            {target}× ({t("payout")}: {Math.floor(bet * Math.pow(2, target) * 0.97).toLocaleString("en")})
          </span>
          <input
            type="range"
            min={1}
            max={7}
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
        </label>
        <button type="button" disabled={busy} onClick={go} className="btn btn-primary w-full">
          {busy ? "…" : t("flip")}
        </button>
        {flips && (
          <div className="flex flex-wrap justify-center gap-2">
            {flips.map((flip, index) => (
              <span
                key={index}
                className={`grid size-10 place-items-center rounded-full border text-xs font-black ${
                  flip === side
                    ? "border-success bg-success/15 text-success"
                    : "border-danger bg-danger/15 text-danger"
                }`}
              >
                {flip === "heads" ? "H" : "T"}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
