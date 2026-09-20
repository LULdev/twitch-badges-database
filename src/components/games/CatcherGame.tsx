"use client";

import { useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError } from "./useGame";

interface Falling {
  id: number;
  x: number;
  y: number;
  speed: number;
  image: string;
  bomb: boolean;
}

/** Drops Catcher — catch falling badges, dodge the bombs. */
export default function CatcherGame() {
  const { bet, setBet, busy, error, play, t } = useGame("catcher");
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [items, setItems] = useState<Falling[]>([]);
  const [caught, setCaught] = useState(0);
  const [missed, setMissed] = useState(0);
  const [basketX, setBasketX] = useState(50);
  const areaRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number>(0);
  const stateRef = useRef({ caught: 0, missed: 0, basketX: 50 });

  const images = useRef<string[]>([]);
  useEffect(() => {
    fetch("/api/games/symbols")
      .then((res) => res.json())
      .then((data: { symbols: Array<{ image: string | null }> }) => {
        images.current = (data.symbols ?? []).map((s) => s.image ?? "").filter(Boolean);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      setItems((prev) => {
        const width = areaRef.current?.clientWidth ?? 600;
        const height = areaRef.current?.clientHeight ?? 320;
        const basketPx = (stateRef.current.basketX / 100) * width;
        const next: Falling[] = [];
        for (const item of prev) {
          const y = item.y + item.speed;
          if (y >= height - 36 && Math.abs(item.x - basketPx) < 42) {
            if (item.bomb) {
              stateRef.current.caught = Math.max(0, stateRef.current.caught - 3);
              setCaught((c) => Math.max(0, c - 3));
            } else {
              stateRef.current.caught += 1;
              setCaught((c) => c + 1);
            }
            continue;
          }
          if (y > height) {
            if (!item.bomb) {
              stateRef.current.missed += 1;
              setMissed((m) => m + 1);
            }
            continue;
          }
          next.push({ ...item, y });
        }
        if (Math.random() < 0.045) {
          next.push({
            id: Math.random(),
            x: 20 + Math.random() * (width - 60),
            y: -20,
            speed: 1.4 + Math.random() * 2.2,
            image: images.current.length
              ? images.current[Math.floor(Math.random() * images.current.length)]
              : "",
            bomb: Math.random() < 0.18,
          });
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    const start = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(start);
      cancelAnimationFrame(raf.current);
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    if (timeLeft <= 0) {
      const finish = requestAnimationFrame(() => {
        setRunning(false);
        cancelAnimationFrame(raf.current);
        void play({ caught: stateRef.current.caught, missed: stateRef.current.missed });
      });
      return () => cancelAnimationFrame(finish);
    }
    const timer = window.setTimeout(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, timeLeft]);

  function move(event: React.MouseEvent<HTMLDivElement>) {
    if (!running) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    setBasketX(x);
    stateRef.current.basketX = x;
  }

  function start() {
    stateRef.current = { caught: 0, missed: 0, basketX: 50 };
    setCaught(0);
    setMissed(0);
    setItems([]);
    setTimeLeft(30);
    setRunning(true);
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={null} />
      <GameError error={error} />
      <div
        ref={areaRef}
        onMouseMove={move}
        className="relative h-80 select-none overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-background to-surface-2"
      >
        {items.map((item) =>
          item.bomb ? (
            <span key={item.id} className="absolute text-2xl" style={{ left: item.x, top: item.y }}>
              💣
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={item.image}
              alt=""
              width={32}
              height={32}
              className="absolute"
              style={{ left: item.x, top: item.y, width: 32, height: 32 }}
            />
          ),
        )}
        <div
          className="absolute bottom-2 h-8 w-20 rounded-t-xl border-2 border-accent bg-accent-soft"
          style={{ left: `calc(${basketX}% - 2.5rem)` }}
        />
        {!running && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <button type="button" onClick={start} className="btn btn-primary px-8 py-3">
              {t("start")}
            </button>
          </div>
        )}
        {running && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-between px-4 text-xs font-black tabular-nums">
            <span>⏱ {timeLeft}s</span>
            <span>🏅 {caught} · ✗ {missed}</span>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted">{t("catcherHint")}</p>
    </div>
  );
}
