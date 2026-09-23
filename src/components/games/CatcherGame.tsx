"use client";

import { useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError, RoundOutcome } from "./useGame";

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
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("catcher");
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [items, setItems] = useState<Falling[]>([]);
  const [caught, setCaught] = useState(0);
  const [missed, setMissed] = useState(0);
  const [basketX, setBasketX] = useState(50);
  const areaRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number>(0);
  const stateRef = useRef({ caught: 0, missed: 0, basketX: 50 });
  // The falling items are mirrored in a ref so the animation loop can resolve
  // collisions OUTSIDE the setState updater. React invokes updaters twice in
  // development, and an updater containing ref writes, nested setState calls
  // and Math.random() made the score posted to the server differ from the one
  // the player saw.
  const itemsRef = useRef<Falling[]>([]);

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
      const width = areaRef.current?.clientWidth ?? 600;
      const height = areaRef.current?.clientHeight ?? 320;
      const basketPx = (stateRef.current.basketX / 100) * width;
      const next: Falling[] = [];
      let caughtNext = stateRef.current.caught;
      let missedNext = stateRef.current.missed;

      for (const item of itemsRef.current) {
        const y = item.y + item.speed;
        if (y >= height - 36 && Math.abs(item.x - basketPx) < 42) {
          if (item.bomb) caughtNext = Math.max(0, caughtNext - 3);
          else caughtNext += 1;
          continue;
        }
        if (y > height) {
          if (!item.bomb) missedNext += 1;
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

      itemsRef.current = next;
      setItems(next);
      if (caughtNext !== stateRef.current.caught) {
        stateRef.current.caught = caughtNext;
        setCaught(caughtNext);
      }
      if (missedNext !== stateRef.current.missed) {
        stateRef.current.missed = missedNext;
        setMissed(missedNext);
      }
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

  // Pointer events, not mouse events: `onMouseMove` never fires for touch or pen,
  // so the basket could not be moved at all on a phone.
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!running) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    setBasketX(x);
    stateRef.current.basketX = x;
  }

  // The basket moves on one axis, so the arrow keys map onto it directly — the
  // game is fully playable from the keyboard without a second input system.
  function nudge(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!running) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -6 : 6;
    const next = Math.min(95, Math.max(5, stateRef.current.basketX + delta));
    setBasketX(next);
    stateRef.current.basketX = next;
  }

  function start() {
    stateRef.current = { caught: 0, missed: 0, basketX: 50 };
    itemsRef.current = [];
    setCaught(0);
    setMissed(0);
    setItems([]);
    setTimeLeft(30);
    setRunning(true);
    // Hand the keyboard to the play field, so the arrow keys work immediately
    // instead of requiring a Tab into it first.
    areaRef.current?.focus();
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <RoundOutcome last={last} />
      <div
        ref={areaRef}
        tabIndex={0}
        // `application` tells assistive technology to pass keystrokes through
        // instead of interpreting them as navigation — which is what a play field
        // with its own arrow-key controls needs.
        role="application"
        aria-label={t("catcherTitle")}
        onPointerMove={move}
        onKeyDown={nudge}
        className="relative h-80 select-none overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-background to-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {items.map((item) =>
          item.bomb ? (
            <span key={item.id} className="absolute text-2xl" style={{ left: item.x, top: item.y }}>
              !
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
            <button type="button" onClick={start} disabled={busy} className="btn btn-primary px-8 py-3">
              {t("start")}
            </button>
          </div>
        )}
        {running && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-between px-4 text-xs font-black tabular-nums">
            <span>{timeLeft}s</span>
            <span>{caught} · ✗ {missed}</span>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted">{t("catcherHint")}</p>
    </div>
  );
}
