"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function diffParts(target: number, now: number) {
  const total = Math.max(0, Math.floor((target - now) / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return { days, hours, minutes, seconds, total };
}

/**
 * Live ticking countdown for limited-time badges. Renders on the server as
 * "—" (avoids hydration drift) and switches to ticking digits on mount.
 */
export default function Countdown({
  target,
  mode,
  size = "sm",
}: {
  target: string;
  mode: "expires" | "starts";
  size?: "sm" | "lg";
}) {
  const t = useTranslations("countdown");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Paint the first tick asynchronously — keeps the component pure on
    // server render (avoids hydration drift) without a sync setState.
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  const targetMs = new Date(target).getTime();
  if (now === null) {
    return (
      <span className="text-xs font-semibold text-muted">— : — : —</span>
    );
  }

  const { days, hours, minutes, seconds, total } = diffParts(targetMs, now);

  if (mode === "expires" && total === 0) {
    return (
      <span className="chip border-danger/40 text-danger">{t("expired")}</span>
    );
  }

  const valueClass = size === "lg" ? "text-xl" : "text-[0.9375rem]";
  const units: Array<{ value: number; label: string }> = [
    { value: days, label: t("days") },
    { value: hours, label: t("hours") },
    { value: minutes, label: t("minutes") },
    { value: seconds, label: t("seconds") },
  ];

  return (
    <span
      className={`countdown ${size === "lg" ? "gap-2" : ""}`}
      role="timer"
      aria-label={`${mode === "expires" ? t("expiresIn") : t("startsIn")}: ${days}${t("days")} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
    >
      {units.map((unit, index) => (
        <span key={unit.label} className="unit">
          <span className={`value ${valueClass}`}>
            {unit.value >= 10 || unit.label !== t("days")
              ? pad(unit.value)
              : unit.value}
          </span>
          <span className="label">{unit.label}</span>
          {index === units.length - 1 ? null : (
            <span className="sr-only">:</span>
          )}
        </span>
      ))}
    </span>
  );
}
