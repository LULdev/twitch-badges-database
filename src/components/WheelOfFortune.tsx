"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Coin from "@/components/Coin";
import CeremonyCoin from "@/components/items/CeremonyCoin";

/**
 * Presentational wheel face only: the order and the labels drawn on the segments.
 * The prize AMOUNTS are deliberately absent — the server is authoritative and
 * returns the awarded slot in the spin response, so the result card shows exactly
 * what was credited. A second numeric copy here could only drift from it.
 */
interface Slot {
  id: string;
  label: string;
  turbo?: boolean;
}

/** The server-awarded slot, as returned by POST /api/wheel/spin. */
interface SpinResult {
  id: string;
  label: string;
  xp: number;
  coins: number;
  turbo: boolean;
}

/** Scaffolding for proving the big-win ceremony card without a real spin
 *  (flipped true for the 2026-10-02 live proof, then back). Seeds the one
 *  non-turbo slot with coins >= 1000 so the Jewel coin and its halo render
 *  on the real anonymous /wheel page. */
const CEREMONY_PREVIEW = false;

const SEGMENTS: Slot[] = [
  { id: "xp25", label: "+25 XP" },
  { id: "xp50", label: "+50 XP" },
  { id: "xp100", label: "+100 XP" },
  { id: "xp250", label: "+250 XP" },
  { id: "xp500", label: "+500 XP" },
  { id: "xp1000", label: "+1,000 XP" },
  { id: "xp2500", label: "+2,500 XP" },
  { id: "turbo", label: "TURBO", turbo: true },
];

const SEGMENT_ANGLE = 360 / SEGMENTS.length;

/**
 * Optimistic spin: the wheel starts turning on the frame the button is clicked,
 * long before the server answers. Degrees are time-based, not per-frame, so the
 * wheel turns at the same speed on a 120 Hz panel as on a 60 Hz one.
 */
const WAIT_SPIN_DEG_PER_MS = 2 / (1000 / 60);
const REDUCED_WAIT_SPIN_DEG_PER_MS = 0.4 / (1000 / 60);

/** Deceleration onto the winning segment once the server has answered. */
const SETTLE_MS = 4200;
const REDUCED_SETTLE_MS = 260;
const EASING = "cubic-bezier(0.15, 0.85, 0.25, 1)";
/** Back-out after a failed spin: never more than a single turn of travel. */
const UNWIND_MS = 500;
const REDUCED_UNWIND_MS = 160;

/**
 * idle     — resting, wheel face and button armed (or spent for today).
 * waiting  — optimistic rAF loop owns style.transform; request is in flight.
 * settling — rAF cancelled, CSS transition is decelerating onto the awarded slot.
 */
type Phase = "idle" | "waiting" | "settling";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The wheel node is the single source of truth for the angle. Writing it here —
 * and never from JSX — means a re-render (result card, error text, locale change)
 * cannot clobber a spin that is in flight.
 */
function applyAngle(node: HTMLDivElement | null, angle: number, transitionMs: number | null): void {
  if (!node) return;
  node.style.transition = transitionMs === null ? "" : `transform ${transitionMs}ms ${EASING}`;
  node.style.transform = `rotate(${angle}deg)`;
}

/** Daily Wheel of Fortune with animated spin and Turbo jackpot slot. */
export default function WheelOfFortune({
  megaPot: initialMegaPot,
}: {
  /** Server-read Mega Jackpot pot (0069) for the ticking display; the spin
   *  response replaces it with the authoritative post-spin value. */
  megaPot?: number | null;
}) {
  const t = useTranslations("wheel");
  const tg = useTranslations("games");
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mega Jackpot (0069): the pot line under the odds, plus the won amount of
  // the spin being displayed. The pot comes from the server — initial prop on
  // load, response value after every spin — never a local copy.
  const [megaPot, setMegaPot] = useState<number | null>(initialMegaPot ?? null);
  const [megaWon, setMegaWon] = useState(0);
  // The daily limit is per account, not per page load: read the current state
  // so a reload does not offer a spin that the server will refuse.
  const [usedToday, setUsedToday] = useState(false);

  const wheelRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  /** The wheel's true visual angle. A ref, not state: it changes ~60x/second. */
  const angleRef = useRef(0);
  /**
   * Mirrors `phase` for the click handler. Two clicks land in the same tick,
   * before React has re-rendered, so the state value alone cannot stop the
   * second request from firing.
   */
  const phaseRef = useRef<Phase>("idle");

  // Nothing survives unmount: the rAF loop would otherwise keep writing to a
  // detached node forever, and the settle timer would fire into the void.
  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/progress")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { wheelSpunToday?: boolean } | null) => {
        if (!cancelled && data?.wheelSpunToday) setUsedToday(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Ceremony proof seeding — see CEREMONY_PREVIEW above. The setState lives
  // in the timeout callback (the repo's set-state-in-effect convention).
  useEffect(() => {
    if (!CEREMONY_PREVIEW) return;
    const timer = setTimeout(() => {
      setResult({ id: "xp2500", label: "+2,500 XP", xp: 2500, coins: 1000, turbo: false });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const wheelStyle = useMemo(
    () => ({
      background: `conic-gradient(${SEGMENTS.flatMap((segment, index) => {
        const start = index * SEGMENT_ANGLE;
        if (segment.turbo) {
          // Rainbow sweep inside the jackpot wedge — same palette as
          // .rarity-mythic in globals.css, drawn as sub-stops of this wedge.
          const rainbow = ["#f87171", "#fbbf24", "#fde68a", "#34d399", "#60a5fa", "#a970ff", "#f472b6", "#f87171"];
          return rainbow.map((color, step) => `${color} ${start + (step * SEGMENT_ANGLE) / (rainbow.length - 1)}deg`);
        }
        const color = index % 2 === 0 ? "#3b2565" : "#1c1133";
        return [`${color} ${start}deg`, `${color} ${start + SEGMENT_ANGLE}deg`];
      }).join(", ")})`,
    }),
    [],
  );

  /** Start the frame loop that owns the wheel until the response lands. */
  function startWaitingSpin(degPerMs: number) {
    const node = wheelRef.current;
    if (!node) return;
    // Drop any leftover transition first, or the first frame would animate.
    applyAngle(node, angleRef.current, null);
    node.style.willChange = "transform";
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) angleRef.current += (now - last) * degPerMs;
      last = now;
      const el = wheelRef.current;
      if (el) el.style.transform = `rotate(${angleRef.current}deg)`;
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }

  function stopWaitingSpin() {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  /** Hand the wheel back at rest: same visual orientation, no jump, no rewind. */
  function unwind() {
    const node = wheelRef.current;
    const angle = angleRef.current;
    // The nearest visually identical resting angle — a whole number of turns —
    // so an unwind can travel at most 360deg instead of spinning back through
    // everything the failed spin had accumulated.
    const rest = angle - (angle % 360);
    phaseRef.current = "idle";
    setPhase("idle");
    if (!node) return;
    node.style.willChange = "";
    if (rest === angle) {
      applyAngle(node, angle, null);
      return;
    }
    angleRef.current = rest;
    applyAngle(node, rest, prefersReducedMotion() ? REDUCED_UNWIND_MS : UNWIND_MS);
  }

  function failWith(message: string, spent: boolean) {
    stopWaitingSpin();
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (spent) setUsedToday(true);
    unwind();
    setError(message);
  }

  async function spin() {
    if (phaseRef.current !== "idle" || usedToday) return;
    const reduced = prefersReducedMotion();
    phaseRef.current = "waiting";
    setPhase("waiting");
    setError(null);
    setResult(null);
    setMegaWon(0);
    startWaitingSpin(reduced ? REDUCED_WAIT_SPIN_DEG_PER_MS : WAIT_SPIN_DEG_PER_MS);
    try {
      const res = await fetch("/api/wheel/spin", { method: "POST" });
      const data = (await res.json()) as
        | {
            slot: { id: string; label: string; xp: number; coins: number; turbo?: boolean };
            turboWon: boolean;
            megaPot?: number;
            megaWon?: number;
          }
        | { error: string; code?: string };
      if ("error" in data) {
        if (data.error === "already-spun-today") {
          failWith(t("already"), true);
        } else if (data.code === "disabled") {
          failWith(t("wheelDisabled"), false);
        } else if (data.code === "not authenticated") {
          failWith(t("notAuthed"), false);
        } else if (data.code === "banned") {
          failWith(t("banned"), false);
        } else {
          failWith(data.error, false);
        }
        return;
      }
      const index = SEGMENTS.findIndex((segment) => segment.id === data.slot.id);
      const segmentIndex = index < 0 ? 0 : index;
      // Rest orientation that parks the pointer (top) on the winning segment.
      const landed = 360 - segmentIndex * SEGMENT_ANGLE - SEGMENT_ANGLE / 2;
      const from = angleRef.current;
      /**
       * Snap the target up to the first angle that is congruent to `landed`
       * (mod a full turn) AND at least one whole turn ahead of where the wheel
       * actually is. Because it is measured from the live animated angle, the
       * settle continues from the current frame — it never rewinds and never
       * jumps — and it always has the travel it needs to decelerate.
       */
      const minSweep = reduced ? 1 : 360;
      let target = from - (from % 360) + landed;
      while (target - from < minSweep) target += 360;

      stopWaitingSpin();
      phaseRef.current = "settling";
      setPhase("settling");
      const duration = reduced ? REDUCED_SETTLE_MS : SETTLE_MS;
      angleRef.current = target;
      applyAngle(wheelRef.current, target, duration);
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        const node = wheelRef.current;
        if (node) node.style.willChange = "";
        phaseRef.current = "idle";
        setPhase("idle");
        setUsedToday(true);
        // The server-awarded amounts, not a local copy of the prize table.
        setResult({
          id: data.slot.id,
          label: data.slot.label,
          xp: data.slot.xp,
          coins: data.slot.coins,
          turbo: Boolean(data.turboWon),
        });
        // Mega Jackpot: adopt the authoritative post-spin pot whether it hit
        // or not, so the line keeps ticking day over day.
        if (typeof data.megaPot === "number") setMegaPot(data.megaPot);
        setMegaWon(typeof data.megaWon === "number" ? data.megaWon : 0);
      }, duration);
    } catch {
      failWith(t("networkError"), false);
    }
  }

  const busy = phase !== "idle";
  const locked = busy || usedToday;
  // Index of the awarded segment — drives the winning-wedge highlight, which
  // starts exactly when the settle timeout fires (the tick the wheel stops).
  const wonIndex = result ? SEGMENTS.findIndex((s) => s.id === result.id) : -1;

  return (
    <div className="space-y-6">
      {/* The face is the primary control: same handler, same lock as the button. */}
      <button
        type="button"
        onClick={spin}
        aria-disabled={locked}
        aria-label={`${tg("spin")} — ${t("title")}`}
        data-phase={phase}
        data-spent={usedToday || undefined}
        data-won={result ? (result.turbo ? "turbo" : "yes") : undefined}
        className={`wheel relative mx-auto block size-72 rounded-full border-0 bg-transparent p-0 text-left sm:size-96 ${locked ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
      >
        {/* Static chassis — never rotates. */}
        <span className="wheel-rim" aria-hidden="true" />
        <span className="wheel-gloss" aria-hidden="true" />

        {/* Idle breathing lives on this wrapper; the face inside stays JS-owned. */}
        <span className="wheel-idle">
          <div ref={wheelRef} className="wheel-face" style={wheelStyle}>
            <span className="wheel-spokes" aria-hidden="true" />
            {SEGMENTS.map((segment, index) => (
              <div
                key={segment.id}
                className={`wheel-seg${index === wonIndex ? " wheel-seg--won" : ""}`}
                style={{ transform: `rotate(${index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2}deg)` }}
              >
                <span
                  dir="ltr"
                  className={`wheel-seg-label${segment.turbo ? " wheel-seg-label--turbo" : ""}`}
                >
                  {segment.label}
                </span>
              </div>
            ))}
          </div>
        </span>

        {/* LED ring — one SVG, scales with the button at both breakpoints. */}
        <svg className="wheel-bulbs" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
          {Array.from({ length: 16 }, (_, i) => (
            <circle
              key={i}
              className="wheel-bulb"
              style={{ "--i": i } as React.CSSProperties}
              cx="0"
              cy="-96.5"
              r="2.4"
              transform={`rotate(${i * 22.5})`}
            />
          ))}
        </svg>

        {/* Jewel-tipped pointer. */}
        <span className="wheel-pointer" aria-hidden="true">
          <svg viewBox="0 0 32 40" focusable="false">
            <defs>
              <linearGradient id="wheel-ptr-gold" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#b45309" />
                <stop offset="0.35" stopColor="#fde68a" />
                <stop offset="0.55" stopColor="#fbbf24" />
                <stop offset="1" stopColor="#92400e" />
              </linearGradient>
              <linearGradient id="wheel-ptr-gem" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9d5ff" />
                <stop offset="0.5" stopColor="#a970ff" />
                <stop offset="1" stopColor="#6d28d9" />
              </linearGradient>
            </defs>
            <path d="M16 40 C10 30 2 24 2 14 a14 14 0 1 1 28 0 c0 10 -8 16 -14 26 z" fill="url(#wheel-ptr-gold)" stroke="#713f12" strokeWidth="1" />
            <circle cx="16" cy="14" r="6.5" fill="url(#wheel-ptr-gem)" stroke="#fde68a" strokeWidth="1" />
            <circle cx="14" cy="11.5" r="1.6" fill="#fff" opacity="0.9" />
          </svg>
        </span>

        <span className="wheel-hub">{tg("spin")}</span>
        <span className="wheel-win-ring" aria-hidden="true" />
        <span className="wheel-flash" aria-hidden="true" />
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={spin}
          disabled={locked}
          aria-disabled={locked}
          className="btn btn-primary btn-lg"
        >
          {busy ? t("spinning") : usedToday ? t("already") : t("spin")}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-warning">
            {error}
          </p>
        )}
        {result && (
          <div
            role="status"
            aria-live="polite"
            className={`card mx-auto mt-4 max-w-sm p-5 ${result.turbo ? "border-warning" : ""}`}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("youWon")}</p>
            <p dir="ltr" className="text-2xl font-black">{result.turbo ? t("turboWon") : result.label}</p>
            {/* Ceremonial moment for big wins (the jackpot or the top paid
                segment), shared with slots and scratch via CeremonyCoin. */}
            {(result.turbo || result.coins >= 1000) && <CeremonyCoin className="mt-3" />}
            <p className="mt-1 text-sm text-muted">
              {result.turbo ? t("turboWon") : (<span dir="ltr" className="inline-flex items-center gap-1.5">+{result.coins.toLocaleString(locale)} <Coin size={16} className="bcoin-lg" /></span>)}
            </p>
            {/* Mega Jackpot win (0069) — its own line under the wheel prize. */}
            {megaWon > 0 && (
              <p dir="ltr" className="mt-2 flex items-center justify-center gap-1.5 text-sm font-black text-warning">
                <Coin variant="b" size={15} className="bcoin-lg" />
                {t("jackpotWon")} +{megaWon.toLocaleString(locale)}
              </p>
            )}
          </div>
        )}
        <p className="mx-auto mt-4 max-w-md text-xs text-muted">{t("turboOdds")}</p>
        {megaPot !== null && (
          <p dir="ltr" className="jackpot-wheel-line mx-auto mt-2">
            <span className="font-bold text-warning">{t("jackpotMega")}</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              {megaPot.toLocaleString(locale)} <Coin size={12} variant="b" />
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
