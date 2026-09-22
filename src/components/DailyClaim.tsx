"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Coin from "@/components/Coin";

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
      // Anything that is not a 2xx is a failure: parsing an error body used to
      // produce a "reward" of undefined values ("+undefined XP").
      if (!res.ok) {
        setState("idle");
        return;
      }
      const data = (await res.json()) as { xp?: number; coins?: number; streak?: number };
      if (typeof data.xp !== "number") {
        setState("idle");
        return;
      }
      setReward({ xp: data.xp, coins: data.coins ?? 0, streak: data.streak ?? 0 });
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
            : t("dailyClaim")}
      </button>
    );
  }

  return (
    <div className="card flex flex-col items-center gap-3 p-6 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      </span>
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
          +{reward.xp} XP · +{reward.coins} <Coin size={14} /> · {t("streak")}: {reward.streak}
        </p>
      )}
      {state === "already" && <p className="text-xs text-muted">{t("dailyComeBack")}</p>}
    </div>
  );
}
