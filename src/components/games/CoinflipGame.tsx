"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useGame, BetBar, GameError } from "./useGame";

export default function CoinflipGame() {
  const { bet, setBet, busy, error, balance, play, t } = useGame("coinflip");
  const locale = useLocale();
  const [side, setSide] = useState<"heads" | "tails">("heads");
  const [target, setTarget] = useState(3);
  const [flips, setFlips] = useState<string[] | null>(null);
  // The side the displayed round was actually played with. Colouring the result
  // against the live `side` re-coloured the whole history after toggling, so a
  // past win could suddenly render as a loss.
  const [playedSide, setPlayedSide] = useState<"heads" | "tails">("heads");

  async function go() {
    const result = await play({ choice: side, target });
    if (!result) return;
    const reported = result.result.side;
    setPlayedSide(reported === "tails" ? "tails" : "heads");
    setFlips((result.result.flips as string[]) ?? []);
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={balance} />
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
            {/* The server pays bet · 2^target · 0.97, so labelling the step "3×"
                promised a multiplier it never paid (target 3 pays 7.76×). Show the
                multiplier that is actually applied. */}
            {(Math.pow(2, target) * 0.97).toFixed(2)}× ({t("payout")}:{" "}
            {Math.floor(bet * Math.pow(2, target) * 0.97).toLocaleString(locale)})
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
                  flip === playedSide
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
