"use client";

import { useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError, RoundOutcome } from "./useGame";

/** Crack the Vault: stop three rotating needles inside the green zone. */
export default function VaultGame() {
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("vault");
  const [phase, setPhase] = useState<"idle" | "dial1" | "dial2" | "dial3" | "done">("idle");
  const [angles, setAngles] = useState([0, 0, 0]);
  const [matches, setMatches] = useState(0);
  const raf = useRef<number>(0);
  // Which dial has already been stopped. A plain boolean was reset only in
  // start(), so after dial 1 every later Stop returned at the guard: dials 2 and
  // 3 could never be stopped, play() never ran, no "play again" appeared and a
  // reload was the only way out. Tracking the dial itself keeps the double-click
  // protection per dial.
  const stoppedDial = useRef(-1);
  const lastStopAt = useRef(0);
  const dialIndex = phase === "dial1" ? 0 : phase === "dial2" ? 1 : phase === "dial3" ? 2 : -1;

  useEffect(() => {
    if (dialIndex < 0) return;
    const speed = 220 + dialIndex * 160;
    const start = performance.now();
    const tick = (now: number) => {
      const angle = (((now - start) / 1000) * speed) % 360;
      setAngles((prev) => {
        const next = [...prev];
        next[dialIndex] = angle;
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [dialIndex]);

  /**
   * Where the green zone sits on a dial, in degrees. The marker is rendered at
   * this angle too — it used to be drawn at a fixed 0° while the judged zone
   * was 30°/130°/230°, so dials 2 and 3 could not be aimed at the visible
   * target at all.
   */
  function zoneAngle(dial: number): number {
    return (30 + dial * 100) % 360;
  }

  function inZone(dial: number): boolean {
    const zone = zoneAngle(dial);
    const angle = angles[dial];
    const diff = Math.min(Math.abs(angle - zone), 360 - Math.abs(angle - zone));
    return diff <= 22;
  }

  function stop() {
    if (dialIndex < 0 || stoppedDial.current === dialIndex) return;
    // A second click whose events straddle a commit sees the NEXT dial, because
    // dialIndex is derived from the phase state. The time guard catches that
    // case as well; without it a double-click could stop two dials at once.
    const now = performance.now();
    if (now - lastStopAt.current < 250) return;
    lastStopAt.current = now;
    stoppedDial.current = dialIndex;
    cancelAnimationFrame(raf.current);
    const hit = inZone(dialIndex);
    const newMatches = matches + (hit ? 1 : 0);
    setMatches(newMatches);
    const nextPhase = phase === "dial1" ? "dial2" : phase === "dial2" ? "dial3" : "done";
    setPhase(nextPhase);
    if (nextPhase === "done") void play({ matches: newMatches });
  }

  function start() {
    stoppedDial.current = -1;
    setMatches(0);
    setAngles([0, 0, 0]);
    setPhase("dial1");
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <RoundOutcome last={last} />
      <div className="card space-y-4 p-6">
        <div className="flex justify-center gap-6">
          {angles.map((angle, index) => (
            <div key={index} className={`relative size-24 rounded-full border-4 ${dialIndex === index ? "border-accent" : "border-line"}`}>
              <div className="absolute inset-2 rounded-full bg-surface-2" />
              <div
                className="absolute inset-0"
                style={{ transform: `rotate(${angle}deg)` }}
              >
                <div className="absolute left-1/2 top-1.5 h-4 w-1 -translate-x-1/2 rounded bg-accent" />
              </div>
              <div
                className="absolute inset-0"
                style={{ transform: `rotate(${zoneAngle(index)}deg)` }}
              >
                <div className="absolute left-1/2 top-1 size-2 -translate-x-1/2 rounded-full bg-success" />
              </div>
            </div>
          ))}
        </div>
        {phase === "idle" && (
          <button type="button" onClick={start} className="btn btn-primary w-full">{t("start")}</button>
        )}
        {dialIndex >= 0 && phase !== "done" && (
          <button type="button" onClick={stop} className="btn btn-primary w-full">{t("stop")}</button>
        )}
        {phase === "done" && (
          <button type="button" onClick={start} className="btn btn-secondary w-full">{t("again")}</button>
        )}
        <p className="text-center text-xs text-muted">{t("vaultHint")}</p>
      </div>
    </div>
  );
}
