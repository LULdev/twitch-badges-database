"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface Slot {
  id: string;
  label: string;
  xp: number;
  coins: number;
  turbo?: boolean;
}

const SEGMENTS: Slot[] = [
  { id: "xp25", label: "+25 XP", xp: 25, coins: 10 },
  { id: "xp50", label: "+50 XP", xp: 50, coins: 20 },
  { id: "xp100", label: "+100 XP", xp: 100, coins: 40 },
  { id: "xp250", label: "+250 XP", xp: 250, coins: 100 },
  { id: "xp500", label: "+500 XP", xp: 500, coins: 200 },
  { id: "xp1000", label: "+1,000 XP", xp: 1000, coins: 400 },
  { id: "xp2500", label: "+2,500 XP", xp: 2500, coins: 1000 },
  { id: "turbo", label: "TURBO", xp: 5000, coins: 50000, turbo: true },
];

const SEGMENT_ANGLE = 360 / SEGMENTS.length;

/** Daily Wheel of Fortune with animated spin and Turbo jackpot slot. */
export default function WheelOfFortune() {
  const t = useTranslations("wheel");
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function spin() {
    if (spinning) return;
    setSpinning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/wheel/spin", { method: "POST" });
      const data = (await res.json()) as
        | { slot: { id: string }; turboWon: boolean }
        | { error: string };
      if ("error" in data) {
        setError(data.error === "already-spun-today" ? t("already") : data.error);
        setSpinning(false);
        return;
      }
      const index = SEGMENTS.findIndex((segment) => segment.id === data.slot.id);
      // Land the pointer (top) on the winning segment: extra full turns included.
      const target = 360 * 6 + (360 - index * SEGMENT_ANGLE - SEGMENT_ANGLE / 2);
      setRotation((prev) => prev + target);
      window.setTimeout(() => {
        setSpinning(false);
        setResult(SEGMENTS[index] ?? null);
      }, 4200);
    } catch {
      setError("Network error");
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
          SPIN
        </div>
      </div>

      <div className="text-center">
        <button type="button" onClick={spin} disabled={spinning} className="btn btn-primary px-10 py-3 text-base">
          {spinning ? t("spinning") : t("spin")}
        </button>
        {error && <p className="mt-3 text-sm font-semibold text-warning">{error}</p>}
        {result && (
          <div className={`card mx-auto mt-4 max-w-sm p-5 ${result.turbo ? "border-warning" : ""}`}>
            <p className="text-2xl font-black">{result.turbo ? "🎁 TWITCH TURBO!" : result.label}</p>
            <p className="mt-1 text-sm text-muted">
              {result.turbo ? t("turboWon") : `+${result.coins.toLocaleString("en")} 🪙`}
            </p>
          </div>
        )}
        <p className="mx-auto mt-4 max-w-md text-xs text-muted">{t("turboOdds")}</p>
      </div>
    </div>
  );
}
