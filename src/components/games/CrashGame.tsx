"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Coin from "@/components/Coin";
import { BetBar, GameAction, GameError, RoundOutcome, type PlayResponse } from "./useGame";
import { crashMultiplierAt } from "@/lib/games/crash-sim";
import {
  FALLBACK_CRASH_THEME,
  drawScene,
  readCrashTheme,
  spawnBurst,
  stepParticles,
  type CrashPhase,
  type CrashScene,
  type CrashTheme,
  type Particles,
} from "./crash/draw";
import { createAudio, type AudioBus } from "./crash/audio";

/**
 * Badge Rocket — the arcade's 15th game and its first live-interactive one.
 * The client is a RENDERER, never an oracle: it animates the climb from the
 * server's `startedAt` plus the shared growth formula, polls the flight
 * four times a second (the crash settles server-side the instant the curve
 * crosses the rolled point) and posts a cash-out that the server grades
 * from its own clock. Nothing the client computes is ever paid on.
 */

type HistoryEntry = { mult: number; won: boolean };

interface BetResponse {
  ok: boolean;
  error?: string;
  flight?: { id: string; startedAt: string; serverNow: string; auto: number | null };
  settled?: PlayResponse;
  balance?: number;
}

type ActiveResponse =
  | { state: "none" }
  | { state: "flying"; flight: { id: string; startedAt: string; serverNow: string; auto: number | null } }
  | { state: "crashed" | "cashed"; at: number; result: PlayResponse };

function MuteIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="m17 9 4 6M21 9l-4 6" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

const AUTO_PRESETS = [1.5, 2, 3, 5, 10];

export default function CrashGame() {
  const t = useTranslations("games");
  const locale = useLocale();
  const [balance, setBalance] = useState<number | null>(null);
  const [bet, setBet] = useState(50);
  const [autoPick, setAutoPick] = useState<number | null>(null);
  const [autoDraft, setAutoDraft] = useState<string | null>(null);
  const [phase, setPhase] = useState<CrashPhase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<PlayResponse | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [flightAuto, setFlightAuto] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const multRef = useRef<HTMLSpanElement | null>(null);
  const amountRef = useRef<HTMLSpanElement | null>(null);
  const sceneRef = useRef<CrashScene>({ phase: "idle", mult: 1, timeMs: 0, auto: null });
  const partsRef = useRef<Particles>([]);
  const juiceRef = useRef({ trauma: 0, flash: 0 });
  const audioRef = useRef<AudioBus | null>(null);
  const themeRef = useRef<CrashTheme>(FALLBACK_CRASH_THEME);
  const startedAtRef = useRef(0);
  const clockOffsetRef = useRef(0);
  const tickLevelRef = useRef(0);
  const moonPlayedRef = useRef(false);
  const autoFiredRef = useRef(false);
  const cashoutBusyRef = useRef(false);
  const hotRef = useRef(false);
  const reduceRef = useRef(false);
  const betRef = useRef(bet);
  const autoRef = useRef(autoPick);
  const localeRef = useRef(locale);
  const betNonceRef = useRef<string | null>(null);
  // Handlers live inside the mount effect (they close over refs only), so
  // the JSX reaches them through this stable ref.
  const actionsRef = useRef<{ launch: () => void; cashout: () => void }>({
    launch: () => undefined,
    cashout: () => undefined,
  });

  useEffect(() => {
    betRef.current = bet;
  }, [bet]);
  useEffect(() => {
    autoRef.current = autoPick;
  }, [autoPick]);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const endFlight = useCallback(
    (result: PlayResponse, kind: "crashed" | "cashed", at: number) => {
      const scene = sceneRef.current;
      const wasFlying = scene.phase === "flying";
      scene.phase = kind === "crashed" ? "crashed" : "cashed";
      if (kind === "crashed") {
        scene.crashAt = at;
        scene.mult = at;
      } else {
        scene.cashedAt = at;
        scene.mult = at;
      }
      betNonceRef.current = null;
      cashoutBusyRef.current = false;
      setPhase(scene.phase);
      setEndedAt(at);
      setFlightAuto(null);
      setLast(result);
      // Freeze the big multiplier at the outcome value (the rAF loop only
      // writes the DOM while flying) and drop the hot-gold class it may
      // have toggled — the next render owns the colour now.
      if (multRef.current) {
        multRef.current.textContent = `${at.toFixed(2)}×`;
        hotRef.current = false;
      }
      if (typeof result.balance === "number") setBalance(result.balance);
      const won = kind === "cashed";
      setHistory((h) => [{ mult: at, won }, ...h].slice(0, 10));
      if (!wasFlying) return;
      const audio = audioRef.current;
      const reduce = reduceRef.current;
      const tip = scene.tip ?? { x: 0, y: 0 };
      if (won) {
        if (!reduce) {
          spawnBurst(partsRef.current, tip.x, tip.y, "coin", 16, 90);
          spawnBurst(partsRef.current, tip.x, tip.y, "puff", 8, 40);
        }
        juiceRef.current.trauma = Math.min(1, juiceRef.current.trauma + 0.4);
        audio?.play("cashout");
        if (at >= 10) audio?.play("moon");
      } else {
        if (!reduce) {
          spawnBurst(partsRef.current, tip.x, tip.y, "spark", 20, 160);
          spawnBurst(partsRef.current, tip.x, tip.y, "debris", 10, 120);
        }
        juiceRef.current.trauma = 1;
        juiceRef.current.flash = 0.5;
        audio?.play("crash");
      }
    },
    [],
  );

  const beginFlight = useCallback(
    (flight: { startedAt: string; serverNow: string; auto: number | null }) => {
      clockOffsetRef.current = Date.parse(flight.serverNow) - Date.now();
      startedAtRef.current = Date.parse(flight.startedAt);
      sceneRef.current = {
        phase: "flying",
        mult: 1,
        timeMs: 0,
        auto: flight.auto,
      };
      tickLevelRef.current = 0;
      moonPlayedRef.current = false;
      autoFiredRef.current = false;
      hotRef.current = false;
      setPhase("flying");
      setEndedAt(null);
      setFlightAuto(flight.auto);
      setError(null);
      audioRef.current?.play("launch");
    },
    [],
  );

  // ── The mount effect: theme, audio, re-attach, the rAF loop, keyboard. ──
  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const audio = createAudio();
    audioRef.current = audio;
    // Mute persists across visits (0081 round 2): a stored "1" restores the
    // last session's choice. The setState rides a rAF — the React Compiler
    // rule (no synchronous setState inside an effect body).
    try {
      if (localStorage.getItem("crash-sound-muted") === "1") {
        audio.setMuted(true);
        requestAnimationFrame(() => setMuted(true));
      }
    } catch {
      /* storage blocked — start unmuted */
    }

    const root = document.documentElement;
    const applyTheme = () => {
      themeRef.current = readCrashTheme(root);
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });

    // Re-attach after a reload: a live flight keeps flying from its own
    // server start time, and one that already ended settles right here.
    let dead = false;
    void (async () => {
      try {
        const res = await fetch("/api/games/crash", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "active" }),
        });
        const data = (await res.json()) as ActiveResponse;
        if (dead) return;
        if (data.state === "flying") beginFlight(data.flight);
        else if (data.state !== "none") endFlight(data.result, data.state, data.at);
      } catch {
        /* offline re-attach — the board simply starts idle */
      }
    })();

    const cashout = () => {
      if (sceneRef.current.phase !== "flying" || cashoutBusyRef.current) return;
      cashoutBusyRef.current = true;
      void (async () => {
        try {
          const res = await fetch("/api/games/crash", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "cashout" }),
          });
          const data = (await res.json()) as PlayResponse;
          if (data.ok) {
            const kind = data.won ? "cashed" : "crashed";
            const at = data.won
              ? Number(data.result.cashed ?? 1)
              : Number(data.result.crash ?? 1);
            endFlight(data, kind, at);
          } else {
            // No flight (the poll beat the click) — the poll owns the verdict.
            cashoutBusyRef.current = false;
          }
        } catch {
          cashoutBusyRef.current = false;
        }
      })();
    };

    const launch = () => {
      if (sceneRef.current.phase === "flying" || cashoutBusyRef.current) return;
      if (sceneRef.current.phase !== "idle") {
        // "Launch again": reset the board, then fall through to a fresh bet.
        sceneRef.current = { phase: "idle", mult: 1, timeMs: 0, auto: null };
        setPhase("idle");
      }
      setBusy(true);
      setError(null);
      betNonceRef.current ??= crypto.randomUUID();
      const nonce = betNonceRef.current;
      void (async () => {
        try {
          const res = await fetch("/api/games/crash", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "bet",
              bet: betRef.current,
              auto: autoRef.current,
              nonce,
            }),
          });
          const data = (await res.json()) as BetResponse;
          if (data.ok && data.flight) {
            betNonceRef.current = null;
            if (typeof data.balance === "number") setBalance(data.balance);
            beginFlight(data.flight);
          } else if (data.ok && data.settled) {
            // A nonce replay whose flight already ended: render the
            // committed verdict instead of quietly failing.
            betNonceRef.current = null;
            const settled = data.settled;
            const kind = settled.won ? "cashed" : "crashed";
            const at = settled.won
              ? Number(settled.result.cashed ?? 1)
              : Number(settled.result.crash ?? 1);
            endFlight(settled, kind, at);
          } else {
            betNonceRef.current = null;
            setError(t("roundFailed"));
            if (typeof data.balance === "number") setBalance(data.balance);
            void refreshBalance();
          }
        } catch {
          // Network unknown: keep the nonce, the retry resumes the flight
          // it already bought instead of charging a second bet.
          setError(t("networkError"));
        } finally {
          setBusy(false);
        }
      })();
    };

    async function refreshBalance() {
      try {
        const res = await fetch("/api/progress");
        const data = (await res.json()) as { coins?: number };
        if (typeof data.coins === "number") setBalance(data.coins);
      } catch {
        /* ignore */
      }
    }
    requestAnimationFrame(() => void refreshBalance());

    actionsRef.current = { launch, cashout };

    const key = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" && ev.code !== "Enter") return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest("button, input, [data-ui]")) return;
      ev.preventDefault();
      audio.unlock();
      if (sceneRef.current.phase === "flying") cashout();
      else launch();
    };
    window.addEventListener("keydown", key);

    const onVis = () => {
      if (document.visibilityState === "visible") audio.unlock();
    };
    document.addEventListener("visibilitychange", onVis);

    // ── The render loop: server-clock curve, ticks, auto trigger, canvas. ──
    let raf = 0;
    let lastFrame = performance.now();
    const loop = (now: number) => {
      if (dead) return;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const scene = sceneRef.current;

      if (scene.phase === "flying") {
        const elapsed = Date.now() + clockOffsetRef.current - startedAtRef.current;
        scene.timeMs = elapsed;
        const m = crashMultiplierAt(elapsed);
        scene.mult = m;
        // The ladder ticks: one per integer multiplier, pitch rising.
        const level = Math.floor(m);
        if (level > tickLevelRef.current) {
          tickLevelRef.current = level;
          audioRef.current?.play("tick", Math.min(level, 24));
        }
        if (m >= 10 && !moonPlayedRef.current) {
          moonPlayedRef.current = true;
          audioRef.current?.play("moon");
        }
        if (multRef.current) {
          multRef.current.textContent = `${m.toFixed(2)}×`;
          const hot = m >= 10;
          if (hot !== hotRef.current) {
            hotRef.current = hot;
            multRef.current.classList.toggle("text-warning", hot);
          }
        }
        if (amountRef.current) {
          amountRef.current.textContent = Math.floor(betRef.current * m).toLocaleString(
            localeRef.current,
          );
        }
        // Client-side auto trigger (snappy): the SERVER enforces the stored
        // target regardless, so a late request still banks exactly it.
        if (scene.auto != null && !autoFiredRef.current && m >= scene.auto) {
          autoFiredRef.current = true;
          cashout();
        }
      }

      stepParticles(partsRef.current, dt);
      const j = juiceRef.current;
      j.trauma = Math.max(0, j.trauma - dt * 1.6);
      j.flash = Math.max(0, j.flash - dt * 2.4);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const bw = Math.max(1, Math.floor(rect.width * dpr));
        const bh = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        const mag = reduceRef.current ? 0 : j.trauma * j.trauma * 10;
        const sx = Math.sin(now * 0.05) * mag;
        const sy = Math.cos(now * 0.073) * mag;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawScene(
          ctx,
          rect.width,
          rect.height,
          scene,
          themeRef.current,
          partsRef.current,
          { shakeX: sx, shakeY: sy, flash: j.flash, now: now / 1000 },
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", onVis);
      themeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── The flight poll: 4 Hz while flying, owns the crash moment. ────────────
  useEffect(() => {
    if (phase !== "flying") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/games/crash", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "active" }),
        });
        const data = (await res.json()) as ActiveResponse;
        if (cancelled) return;
        if (data.state === "crashed" || data.state === "cashed") {
          endFlight(data.result, data.state, data.at);
        }
      } catch {
        /* a dropped poll retries on the next tick */
      }
    };
    const iv = setInterval(() => void poll(), 250);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [phase, endFlight]);

  const flying = phase === "flying";
  const multClass =
    phase === "crashed"
      ? "text-danger"
      : phase === "cashed"
        ? "text-success"
        : phase === "flying"
          ? "text-foreground"
          : "text-muted";

  return (
    <div className="space-y-4">
      {!flying && (
        <BetBar bet={bet} setBet={setBet} min={10} max={1000} busy={busy || phase !== "idle"} balance={balance} />
      )}
      <GameError error={error} />
      <div className="card overflow-hidden p-0">
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="block h-[380px] w-full touch-none select-none sm:h-[460px]"
            aria-label={t("crashTitle")}
          />
          {/* The live multiplier — DOM, not canvas: crisp in both themes and
              locale-correct. Mutated per frame by the rAF loop (never state:
              60 renders a second would jank the whole board). */}
          <div className="pointer-events-none absolute inset-x-0 top-1/3 flex flex-col items-center gap-1">
            <span
              ref={multRef}
              className={`text-4xl font-extrabold tabular-nums drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] sm:text-5xl ${multClass}`}
              dir="ltr"
            >
              1.00×
            </span>
            {phase === "crashed" && endedAt != null && (
              <span className="chip bg-background/75 text-danger" dir="ltr">
                {t("crashCrashedAt", { mult: endedAt.toFixed(2) })}
              </span>
            )}
            {phase === "cashed" && endedAt != null && (
              <span className="chip bg-background/75 text-success" dir="ltr">
                {t("crashCashedAt", { mult: endedAt.toFixed(2) })}
              </span>
            )}
            {flying && flightAuto != null && (
              <span className="chip bg-background/70 text-warning" dir="ltr">
                {t("crashAutoChip", { mult: flightAuto.toFixed(2) })}
              </span>
            )}
          </div>
          {history.length > 0 && (
            <div
              className="pointer-events-none absolute bottom-3 left-3 flex max-w-[70%] flex-wrap gap-1.5"
              aria-label={t("crashHistory")}
            >
              {history.map((entry, i) => (
                <span
                  key={`${entry.mult}-${i}`}
                  className={`chip bg-background/70 text-xs tabular-nums ${
                    entry.won ? "text-success" : "text-danger"
                  }`}
                  dir="ltr"
                >
                  {entry.mult.toFixed(2)}×
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            data-ui
            aria-label={muted ? t("unmute") : t("mute")}
            className="btn btn-ghost btn-sm absolute right-3 top-3"
            onClick={() => {
              const next = !audioRef.current?.muted();
              audioRef.current?.setMuted(next ?? false);
              setMuted(next ?? false);
              try {
                localStorage.setItem("crash-sound-muted", next ? "1" : "0");
              } catch {
                /* storage blocked — the toggle still works for this visit */
              }
            }}
          >
            <MuteIcon muted={muted} />
          </button>
        </div>
      </div>

      {/* Auto cash-out: baked into the flight server-side at launch, so a
          closed tab still banks exactly the target. */}
      {!flying && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold text-muted">{t("crashAuto")}</span>
          <button
            type="button"
            className={`chip ${autoPick == null ? "chip-active" : ""}`}
            disabled={phase !== "idle" || busy}
            onClick={() => setAutoPick(null)}
          >
            {t("crashAutoOff")}
          </button>
          {AUTO_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip tabular-nums ${autoPick === preset ? "chip-active" : ""}`}
              disabled={phase !== "idle" || busy}
              onClick={() => setAutoPick(preset)}
            >
              {preset.toFixed(1)}×
            </button>
          ))}
          {/* A free auto target (1.01×–250×) — the BetBar draft pattern: the
              value only commits on blur/Enter, so typing is never fought by
              clamping. An emptied field switches auto OFF. */}
          <input
            type="number"
            className="input w-24 py-1.5 text-sm tabular-nums"
            min={1.01}
            max={250}
            step={0.01}
            placeholder={t("crashAutoCustom")}
            value={
              autoDraft ??
              (autoPick != null && !AUTO_PRESETS.includes(autoPick)
                ? autoPick.toFixed(2)
                : "")
            }
            onFocus={() => setAutoDraft(autoPick != null ? autoPick.toFixed(2) : "")}
            onChange={(event) => setAutoDraft(event.target.value)}
            onBlur={() => {
              if (autoDraft === null) return;
              const parsed = Number(autoDraft);
              if (autoDraft.trim() !== "" && Number.isFinite(parsed)) {
                setAutoPick(Math.min(250, Math.max(1.01, Math.round(parsed * 100) / 100)));
              } else {
                setAutoPick(null);
              }
              setAutoDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            disabled={phase !== "idle" || busy}
            aria-label={t("crashAutoCustom")}
            data-ui
          />
        </div>
      )}

      {flying ? (
        <button
          type="button"
          onClick={() => actionsRef.current.cashout()}
          className="btn btn-primary btn-lg w-full tabular-nums"
        >
          {t("crashCashout")}
          <span ref={amountRef} className="inline-flex items-center gap-1" dir="ltr">
            50 <Coin size={14} />
          </span>
        </button>
      ) : (
        <GameAction
          onClick={() => actionsRef.current.launch()}
          disabled={busy}
          variant={phase === "idle" ? "primary" : "secondary"}
        >
          {phase === "idle" ? (
            <span className="inline-flex items-center gap-2">
              <RocketIcon />
              {t("crashLaunch")}
            </span>
          ) : (
            t("crashAgain")
          )}
        </GameAction>
      )}
      <p className="text-center text-xs text-muted">{t("crashHint")}</p>
      <RoundOutcome last={last} />
    </div>
  );
}
