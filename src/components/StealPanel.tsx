"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** Steal coins from another collector (share-link target). */
export default function StealPanel({
  victim,
  price,
  maxAmount,
}: {
  victim: string;
  price: number;
  maxAmount: number;
}) {
  const t = useTranslations("steal");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function attempt() {
    setState("busy");
    setResult(null);
    try {
      const res = await fetch("/api/steal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ victim }),
      });
      const data = (await res.json()) as
        | { ok: true; success: boolean; stolen: number; cost: number; chance: number }
        | { ok: false; error: string };
      if (!data.ok) {
        setResult(data.error);
      } else if (data.success) {
        setResult(t("success", { coins: data.stolen.toLocaleString("en") }));
        router.refresh();
      } else {
        setResult(t("failed", { coins: data.cost.toLocaleString("en") }));
        router.refresh();
      }
    } catch {
      setResult("Network error");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="card space-y-2 p-4">
      <p className="text-xs text-muted">
        🥷 {t("hint", { price: price.toLocaleString("en"), max: maxAmount.toLocaleString("en") })}
      </p>
      <button type="button" onClick={attempt} disabled={state === "busy"} className="btn btn-danger w-full text-xs">
        {state === "busy" ? "…" : t("attempt")}
      </button>
      {result && <p className="text-xs font-semibold text-muted">{result}</p>}
    </div>
  );
}
