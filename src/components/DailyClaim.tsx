"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Daily bonus claim button (+10 XP, streak bonus). */
export default function DailyClaim({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("games");
  const [state, setState] = useState<"idle" | "busy" | "done" | "already">("idle");
  const [reward, setReward] = useState<{ xp: number; coins: number; streak: number } | null>(null);

  async function claim() {
    setState("busy");
    try {
      const res = await fetch("/api/daily/claim", { method: "POST" });
      if (res.status === 429) {
        setState("already");
        return;
      }
      const data = (await res.json()) as { xp: number; coins: number; streak: number };
      setReward(data);
      setState("done");
    } catch {
      setState("idle");
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={claim}
        disabled={state === "busy" || state === "done" || state === "already"}
        className={`btn text-xs ${state === "done" ? "btn-secondary" : "btn-primary"}`}
        title={reward ? `+${reward.xp} XP · Tag ${reward.streak}` : undefined}
      >
        {state === "done"
          ? `✓ ${t("dailyDone")}`
          : state === "already"
            ? `✓ ${t("dailyDone")}`
            : `🎁 ${t("dailyClaim")}`}
      </button>
    );
  }

  return (
    <div className="card flex flex-col items-center gap-3 p-6 text-center">
      <span className="text-3xl">🎁</span>
      <h2 className="font-bold">{t("dailyTitle")}</h2>
      <p className="text-sm text-muted">{t("dailyHint")}</p>
      <button
        type="button"
        onClick={claim}
        disabled={state === "busy" || state === "done" || state === "already"}
        className="btn btn-primary px-8"
      >
        {state === "busy" ? "…" : state === "done" || state === "already" ? `✓ ${t("dailyDone")}` : t("dailyClaim")}
      </button>
      {reward && (
        <p className="text-sm font-bold text-success">
          +{reward.xp} XP · +{reward.coins} 🪙 · {t("streak")}: {reward.streak}
        </p>
      )}
      {state === "already" && <p className="text-xs text-muted">{t("dailyComeBack")}</p>}
    </div>
  );
}
