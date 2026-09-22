"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

/** Steal coins from another collector (share-link target). */
export default function StealPanel({
  victim,
  price,
  maxAmount,
  enabled = true,
}: {
  victim: string;
  price: number;
  maxAmount: number;
  /** The victim's `steal_enabled` setting; a disabled target shows a note. */
  enabled?: boolean;
}) {
  const t = useTranslations("steal");
  const locale = useLocale();
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
        setResult(t("success", { coins: data.stolen.toLocaleString(locale) }));
        router.refresh();
      } else {
        setResult(t("failed", { coins: data.cost.toLocaleString(locale) }));
        router.refresh();
      }
    } catch {
      setResult("Network error");
    } finally {
      setState("idle");
    }
  }

  // A collector who disabled stealing must not be presented with a working
  // button that can only fail — the server refuses the attempt anyway.
  if (!enabled) {
    return (
      <div className="card p-4">
        <p className="text-xs text-muted">{t("disabled")}</p>
      </div>
    );
  }

  return (
    <div className="card space-y-2 p-4">
      <p className="text-xs text-muted">
        {t("hint", { price: price.toLocaleString(locale), max: maxAmount.toLocaleString(locale) })}
      </p>
      <button type="button" onClick={attempt} disabled={state === "busy"} className="btn btn-danger w-full text-xs">
        {state === "busy" ? "…" : t("attempt")}
      </button>
      {result && <p className="text-xs font-semibold text-muted">{result}</p>}
    </div>
  );
}
