"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createSim,
  rankIndex,
  step,
  tap,
  type GameEvent,
  type Sim,
} from "@/lib/games/pingu-sim";
import { createAudio, type AudioBus } from "./pingu/audio";
import {
  desiredCam,
  drawWorld,
  loadSprites,
  spawnBurst,
  stepParticles,
  type Cam,
  type Particle,
  type Sprites,
} from "./pingu/draw";
import { BetBar, GameError, RoundOutcome, useGame } from "./useGame";

const BEST_KEY = "pingu-throw-best";

// Seconds of dive time before which a swing tap cannot reach the penguin
// (the club geometry whiffs it). Taps earlier than this are buffered and
// fired at the moment — measured on the sim curve, real contact starts at
// ~1.40 s (12.6 m, steep) and peaks at ~1.65 s (375 m).
const SWING_GRACE_AT = 1.4;

type Hud = {
  phase: Sim["phase"];
  meters: number;
  best: number;
  rank: number;
  muted: boolean;
  ready: boolean;
};

function readBest(): number {
  try {
    const n = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeBest(n: number) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    /* ignore quota */
  }
}

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

/**
 * Pingu Throw — the 14th arcade game. The round is pure client physics, but
 * the CLIENT NEVER STATES ITS SCORE: on "done" it sends only the tap timing
 * (clickAtMs, snapped to the sim's own 1/120 step grid) and the server
 * replays the throw with the same deterministic sim to derive meters, payout
 * and the jackpot roll. Whiffs that never swung cost nothing — the bet is
 * placed by swinging at the penguin.
 */
export default function PinguGame() {
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("pingu");
  const tt = useTranslations("games");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(createSim());
  const audioRef = useRef<AudioBus | null>(null);
  const spritesRef = useRef<Sprites | null>(null);
  const camRef = useRef<Cam>({ x: 1, y: 0, ppm: 60, ax: 0.48, ay: 0.8 });
  const camReady = useRef(false);
  const parts = useRef<Particle[]>([]);
  const juice = useRef({ trauma: 0, flash: 0, hitstop: 0, squash: 1 });
  const bestRef = useRef(0);
  const queued = useRef(false);
  const reduce = useRef(false);
  // Tap timing for the server replay, in sim seconds (snapped to 1/120).
  const clickAtRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const pendingEarlySwing = useRef(false);
  const [hud, setHud] = useState<Hud>({
    phase: "ready",
    meters: 0,
    best: 0,
    rank: 1,
    muted: false,
    ready: false,
  });

  useEffect(() => {
    bestRef.current = readBest();
    setHud((h) => ({ ...h, best: bestRef.current }));
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const audio = createAudio();
    audioRef.current = audio;
    const sim = simRef.current;
    let dead = false;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    let newBestLatch = false;

    const publish = (force = false) => {
      const rank = sim.phase === "done" && sim.hit ? rankIndex(sim.meters) : 0;
      setHud((h) => {
        if (
          !force &&
          h.phase === sim.phase &&
          Math.abs(h.meters - sim.meters) < 0.05 &&
          h.best === bestRef.current &&
          h.rank === rank &&
          h.muted === (audioRef.current?.muted() ?? false)
        ) {
          return h;
        }
        return {
          ...h,
          phase: sim.phase,
          meters: sim.meters,
          best: bestRef.current,
          rank,
          muted: audioRef.current?.muted() ?? false,
          ready: true,
        };
      });
    };

    const submit = () => {
      // The swing is the bet: throws without a swing (idle faceplant) cost
      // nothing and are not submitted. One submission per throw.
      if (clickAtRef.current == null || submittingRef.current) return;
      const clickAtMs = Math.round(clickAtRef.current * 1000);
      clickAtRef.current = null;
      submittingRef.current = true;
      void play({ clickAtMs }).finally(() => {
        submittingRef.current = false;
      });
    };

    const onEvents = (events: GameEvent[]) => {
      const bus = audioRef.current;
      for (const e of events) {
        if (e.type === "dive") bus?.play("dive");
        if (e.type === "swing") bus?.play("swing");
        if (e.type === "hit") {
          bus?.play("hit", e.power);
          juice.current.hitstop = reduce.current ? 0 : 0.045 + e.power * 0.04;
          juice.current.trauma = Math.min(1, juice.current.trauma + 0.35 + e.power * 0.4);
          juice.current.flash = 0.35;
          juice.current.squash = 1.35;
          spawnBurst(parts.current, sim.x, sim.y, "puff", 14, 4);
          spawnBurst(parts.current, sim.x, sim.y, "spark", 8, 6);
        }
        if (e.type === "bounce") {
          bus?.play("bounce");
          juice.current.trauma = Math.min(1, juice.current.trauma + 0.22);
          juice.current.squash = 0.72;
          spawnBurst(parts.current, sim.x, 0.2, "puff", 8, 3);
        }
        if (e.type === "stick") {
          bus?.play("stick");
          juice.current.hitstop = reduce.current ? 0 : 0.07;
          juice.current.trauma = Math.min(1, juice.current.trauma + 0.55);
          juice.current.squash = 0.62;
          spawnBurst(parts.current, sim.x, 0.3, "chip", 16, 5);
        }
        if (e.type === "whiff") bus?.play("whiff");
        if (e.type === "done") {
          const isBest = sim.meters > bestRef.current + 0.05 && sim.meters > 8;
          if (isBest) {
            bestRef.current = sim.meters;
            writeBest(sim.meters);
            newBestLatch = true;
            bus?.play("best");
          } else {
            newBestLatch = false;
            if (sim.hit) bus?.play("done");
          }
          publish(true);
          submit();
        }
      }
    };

    const fireSwing = () => {
      // The swing IS the bet placement: capture the sim's own clock (already
      // on the 1/120 grid) so the server replay lands on the same step the
      // player saw.
      clickAtRef.current = Math.round(sim.time * 120) / 120;
      onEvents(tap(sim));
      publish(true);
    };

    const act = () => {
      if (sim.phase === "ready") newBestLatch = false;
      if (sim.phase === "dive" && sim.time < SWING_GRACE_AT) {
        // Input buffering: a tap while the penguin is still above the club's
        // reach would whiff on geometry alone (0.46 m faceplant), punishing
        // eager players for timing they cannot see. Hold the tap and fire the
        // swing the moment the dive reaches the earliest hittable height —
        // clickAt records the EFFECTIVE swing time, so the server replay
        // matches what the player watched. Late taps (penguin grounded) stay
        // honest whiffs.
        pendingEarlySwing.current = true;
        return;
      }
      if (sim.phase === "dive") {
        fireSwing();
        return;
      }
      onEvents(tap(sim));
      publish(true);
    };

    const canvasEl = canvasRef.current;
    const pointer = () => {
      audio.unlock();
      if (!spritesRef.current) {
        queued.current = true;
        return;
      }
      act();
    };
    canvasEl?.addEventListener("pointerdown", pointer);

    const key = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" && ev.code !== "Enter") return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest("button, input, [data-ui]")) return;
      ev.preventDefault();
      audio.unlock();
      if (!spritesRef.current) {
        queued.current = true;
        return;
      }
      act();
    };
    window.addEventListener("keydown", key);

    const loop = (now: number) => {
      if (dead) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const canvas = canvasRef.current;
      const sprites = spritesRef.current;
      if (canvas && sprites) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const bw = Math.max(1, Math.floor(rect.width * dpr));
        const bh = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Fire a buffered early tap at the earliest hittable height: the
          // swing starts on the same 1/120 step the player's meter shows.
          if (
            pendingEarlySwing.current &&
            sim.phase === "dive" &&
            sim.time >= SWING_GRACE_AT
          ) {
            pendingEarlySwing.current = false;
            fireSwing();
          }
          juice.current.hitstop = Math.max(0, juice.current.hitstop - dt);
          if (juice.current.hitstop <= 0) {
            acc += dt;
            const stepDt = 1 / 120;
            while (acc >= stepDt) {
              onEvents(step(sim, stepDt));
              acc -= stepDt;
            }
          }
          stepParticles(parts.current, dt);
          const want = desiredCam(sim, rect.width, rect.height);
          const cam = camRef.current;
          if (!camReady.current) {
            Object.assign(cam, want);
            camReady.current = true;
          } else {
            const k = 1 - Math.exp(-3.4 * dt);
            cam.x += (want.x - cam.x) * k;
            cam.y += (want.y - cam.y) * k;
            cam.ppm += (want.ppm - cam.ppm) * k;
            cam.ax += (want.ax - cam.ax) * k;
            cam.ay += (want.ay - cam.ay) * k;
          }
          const j = juice.current;
          j.trauma = Math.max(0, j.trauma - dt * 1.6);
          j.flash = Math.max(0, j.flash - dt * 2.4);
          j.squash += (1 - j.squash) * (1 - Math.exp(-8 * dt));
          const mag = reduce.current ? 0 : j.trauma * j.trauma * 10;
          const sx = Math.sin(now * 0.05) * mag;
          const sy = Math.cos(now * 0.073) * mag;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawWorld(ctx, sim, sprites, cam, rect.width, rect.height, parts.current, bestRef.current, sx, sy, j.flash, j.squash, now / 1000);
        }
      }
      hudAcc += dt;
      if (hudAcc > 0.08) {
        hudAcc = 0;
        publish(false);
      }
      raf = requestAnimationFrame(loop);
    };

    void (async () => {
      try {
        const sprites = await loadSprites();
        if (dead) return;
        spritesRef.current = sprites;
        setHud((h) => ({ ...h, ready: true, best: bestRef.current }));
        if (queued.current) {
          queued.current = false;
          act();
        }
      } catch (err) {
        console.error("[pingu] sprite load failed:", err);
      }
    })();

    raf = requestAnimationFrame(loop);

    const onVis = () => {
      if (document.visibilityState === "visible") audio.unlock();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      canvasEl?.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rankLabel =
    hud.phase === "done" && hud.rank > 0 ? tt(`rank${hud.rank}` as Parameters<typeof tt>[0]) : null;

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <div className="card overflow-hidden p-0">
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="block h-[380px] w-full touch-none select-none sm:h-[460px]"
            aria-label={tt("pinguTitle")}
          />
          {!hud.ready && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted">…</div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
            <span className="chip bg-background/70">{hud.meters.toFixed(1)} m</span>
            {hud.best > 8 && (
              <span className="chip bg-background/70">{tt("bestShort", { best: Math.round(hud.best) })}</span>
            )}
          </div>
          {rankLabel && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
              <span className="chip bg-background/80">{rankLabel}</span>
            </div>
          )}
          <button
            type="button"
            data-ui
            aria-label={hud.muted ? tt("unmute") : tt("mute")}
            className="btn btn-ghost btn-sm absolute right-3 top-3"
            onClick={() => audioRef.current?.setMuted(!audioRef.current.muted())}
          >
            <MuteIcon muted={hud.muted} />
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-muted">{tt("pinguHint")}</p>
      <RoundOutcome last={last} />
    </div>
  );
}