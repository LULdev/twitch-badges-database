"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError, RoundOutcome } from "./useGame";

interface Target {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  image: string;
}

/** Shoot the Badges — Moorhuhn-style 30-second badge hunt. */
export default function ShootGame() {
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("shoot");
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [hits, setHits] = useState(0);
  const [shots, setShots] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number>(0);
  const stateRef = useRef({ hits: 0, shots: 0 });
  const targetsRef = useRef<Target[]>([]);

  const images = useRef<string[]>([]);
  useEffect(() => {
    fetch("/api/games/symbols")
      .then((res) => res.json())
      .then((data: { symbols: Array<{ image: string | null }> }) => {
        images.current = (data.symbols ?? []).map((s) => s.image ?? "").filter(Boolean);
      })
      .catch(() => undefined);
  }, []);

  const spawn = useCallback((): Target => {
    const width = areaRef.current?.clientWidth ?? 600;
    return {
      id: Math.random(),
      x: 40 + Math.random() * (width - 120),
      y: 260 + Math.random() * 160,
      vx: (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 2.5),
      vy: -(0.5 + Math.random() * 1.2),
      image: images.current.length
        ? images.current[Math.floor(Math.random() * images.current.length)]
        : "",
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 16.7;
      last = now;
      const width = areaRef.current?.clientWidth ?? 600;
      const next = targetsRef.current
        .map((target) => ({
          ...target,
          x: target.x + target.vx * dt,
          y: target.y + target.vy * dt,
        }))
        .filter((target) => target.y > -40 && target.x > -40 && target.x < width + 40);
      if (next.length < 6 && Math.random() < 0.06) next.push(spawn());
      targetsRef.current = next;
      setTargets(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, spawn]);

  useEffect(() => {
    if (!running) return;
    if (timeLeft <= 0) {
      const finish = requestAnimationFrame(() => {
        setRunning(false);
        cancelAnimationFrame(raf.current);
        const { hits: h, shots: sh } = stateRef.current;
        void play({ hits: h, shots: sh }).then((res) => {
          if (!res) return;
          // The server decides the outcome; the client summary must not imply
          // a win from its own accuracy figure.
          setSummary(
            `${h} / ${sh} — ${res.won ? t("youWin") : t("youLose")} (${res.payout})`,
          );
        });
      });
      return () => cancelAnimationFrame(finish);
    }
    const timer = window.setTimeout(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, timeLeft]);

  function start() {
    stateRef.current = { hits: 0, shots: 0 };
    setHits(0);
    setShots(0);
    setSummary(null);
    setTimeLeft(30);
    const initial = Array.from({ length: 4 }, () => spawn());
    targetsRef.current = initial;
    setTargets(initial);
    setRunning(true);
  }

  function shoot(event: React.MouseEvent<HTMLDivElement>) {
    if (!running) return;
    stateRef.current.shots += 1;
    setShots((prev) => prev + 1);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hitIndex = targetsRef.current.findIndex(
      (target) => Math.hypot(target.x + 22 - x, target.y + 22 - y) < 30,
    );
    if (hitIndex !== -1) {
      const next = [...targetsRef.current];
      next.splice(hitIndex, 1);
      targetsRef.current = next;
      stateRef.current.hits += 1;
      setHits(stateRef.current.hits);
      setTargets(next);
    }
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <RoundOutcome last={last} />
      <div
        ref={areaRef}
        onClick={shoot}
        className={`relative h-80 select-none overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-surface-2 to-background ${running ? "cursor-crosshair" : ""}`}
      >
        {targets.map((target) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={target.id}
            src={target.image}
            alt=""
            width={44}
            height={44}
            className="absolute transition-none"
            style={{ left: target.x, top: target.y, width: 44, height: 44 }}
          />
        ))}
        {!running && (
          <div className="absolute inset-0 grid place-items-center">
            <button type="button" onClick={start} disabled={busy} className="btn btn-primary px-8 py-3">
              {t("start")}
            </button>
          </div>
        )}
        {running && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-between px-4 text-xs font-black tabular-nums">
            <span>{timeLeft}s</span>
            <span>{hits}/{shots}</span>
          </div>
        )}
        {summary && !running && (
          <div className="absolute inset-x-0 bottom-3 text-center text-sm font-bold text-muted">
            {summary}
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted">{t("shootHint")}</p>
    </div>
  );
}
