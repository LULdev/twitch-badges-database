"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Coin from "@/components/Coin";

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

/** Daily Wheel of Fortune with animated spin and Turbo jackpot slot. */
export default function WheelOfFortune() {
  const t = useTranslations("wheel");
  const tg = useTranslations("games");
  const locale = useLocale();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The daily limit is per account, not per page load: read the current state
  // so a reload does not offer a spin that the server will refuse.
  const [usedToday, setUsedToday] = useState(false);
  const spinTimer = useRef<number | null>(null);
  // Cancel the pending state update on unmount: React 18 no longer warns about
  // setting state on an unmounted component, so nothing surfaced this.
  useEffect(
    () => () => {
      if (spinTimer.current !== null) window.clearTimeout(spinTimer.current);
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

  async function spin() {
    if (spinning) return;
    setSpinning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/wheel/spin", { method: "POST" });
      const data = (await res.json()) as
        | {
            slot: { id: string; label: string; xp: number; coins: number; turbo?: boolean };
            turboWon: boolean;
          }
        | { error: string; code?: string };
      if ("error" in data) {
        if (data.error === "already-spun-today") {
          setUsedToday(true);
          setError(t("already"));
        } else if (data.code === "disabled") {
          setError(t("wheelDisabled"));
        } else if (data.code === "not authenticated") {
          setError(t("notAuthed"));
        } else if (data.code === "banned") {
          setError(t("banned"));
        } else {
          setError(data.error);
        }
        setSpinning(false);
        return;
      }
      const index = SEGMENTS.findIndex((segment) => segment.id === data.slot.id);
      const segmentIndex = index < 0 ? 0 : index;
      // Land the pointer (top) on the winning segment: extra full turns included.
      const target = 360 * 6 + (360 - segmentIndex * SEGMENT_ANGLE - SEGMENT_ANGLE / 2);
      setRotation((prev) => prev + target);
      spinTimer.current = window.setTimeout(() => {
        setSpinning(false);
        setUsedToday(true);
        // The server-awarded amounts, not a local copy of the prize table.
        setResult({
          id: data.slot.id,
          label: data.slot.label,
          xp: data.slot.xp,
          coins: data.slot.coins,
          turbo: Boolean(data.turboWon),
        });
      }, 4200);
    } catch {
      setError(t("networkError"));
      setSpinning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="relative mx-auto size-72 sm:size-96">
        <div className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 text-2xl">▼</div>
        <div
          className="size-full rounded-full border-4 border-line-strong shadow-glow"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? "transform 4s cubic-bezier(0.15, 0.85, 0.25, 1)" : undefined,
            background: `conic-gradient(${SEGMENTS.map((segment, index) => {
              const start = index * SEGMENT_ANGLE;
              const color = segment.turbo ? "#fbbf24" : index % 2 === 0 ? "#a970ff" : "#2c1a4d";
              return `${color} ${start}deg ${(start + SEGMENT_ANGLE)}deg`;
            }).join(", ")})`,
          }}
        >
          {SEGMENTS.map((segment, index) => (
            <div
              key={segment.id}
              className="absolute inset-0 flex justify-center"
              style={{ transform: `rotate(${index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2}deg)` }}
            >
              <span
                className={`mt-5 whitespace-nowrap text-[0.625rem] font-black tracking-wide sm:text-xs ${segment.turbo ? "text-black" : "text-white"}`}
                style={{ writingMode: "vertical-rl" }}
              >
                {segment.label}
              </span>
            </div>
          ))}
        </div>
        <div className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-line-strong bg-background text-xs font-black">
          {tg("spin")}
        </div>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={spin}
          disabled={spinning || usedToday}
          className="btn btn-primary px-10 py-3 text-base"
        >
          {spinning ? t("spinning") : usedToday ? t("already") : t("spin")}
        </button>
        {error && <p className="mt-3 text-sm font-semibold text-warning">{error}</p>}
        {result && (
          <div className={`card mx-auto mt-4 max-w-sm p-5 ${result.turbo ? "border-warning" : ""}`}>
            <p className="text-2xl font-black">{result.turbo ? t("turboWon") : result.label}</p>
            <p className="mt-1 text-sm text-muted">
              {result.turbo ? t("turboWon") : (<span dir="ltr" className="inline-flex items-center gap-1.5">+{result.coins.toLocaleString(locale)} <Coin size={16} className="bcoin-lg" /></span>)}
            </p>
          </div>
        )}
        <p className="mx-auto mt-4 max-w-md text-xs text-muted">{t("turboOdds")}</p>
      </div>
    </div>
  );
}
