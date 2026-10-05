"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Coin from "@/components/Coin";

/**
 * Buy one Streak Freeze from the profile item shelf (own profile only).
 * `canAfford` is computed server-side from the viewer's real balance; the
 * route re-checks everything atomically, so a stale prop can at worst offer
 * a button that answers "insufficient". Follows the server's answer and
 * refreshes the RSC payload so the stock chip updates (the StealPanel
 * pattern). The price is display-only — the server reads the real price.
 */
export default function BuyFreezeButton({
  price,
  canAfford,
  max,
}: {
  price: number;
  canAfford: boolean;
  max: number;
}) {
  const t = useTranslations("profile");
  const te = useTranslations("errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function buy() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/items/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item: "streak_freeze" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; code?: string; price?: number }
        | null;
      if (!res.ok || !data?.ok) {
        // Map the server's stable code to a localized message; the price the
        // server echoes is authoritative over the prop.
        const echoed = data?.price ?? price;
        if (data?.code === "at_cap") setError(t("buyCapped", { max }));
        else if (data?.code === "insufficient")
          setError(t("buyInsufficient", { price: echoed }));
        else setError(te("generic"));
        return;
      }
      setDone(true);
      // Re-render the server components so the shelf stock chip updates.
      router.refresh();
    } catch {
      setError(te("generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-center gap-1 sm:items-start">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={buy}
        disabled={busy || !canAfford}
      >
        {busy ? "…" : t("buyFreeze")}
        <span className="inline-flex items-center gap-1 tabular-nums">
          {price.toLocaleString("en-US")} <Coin size={12} />
        </span>
      </button>
      {!canAfford && !error ? (
        <span className="text-xs text-muted">
          {t("buyInsufficient", { price })}
        </span>
      ) : null}
      {done ? <span className="text-xs text-success">{t("buyDone")}</span> : null}
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
