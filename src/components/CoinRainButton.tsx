"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Coin from "@/components/Coin";

/** Coin rain easter egg: visitors gift the profile owner 1 coin (once/day). */
export default function CoinRainButton({ profileId }: { profileId: string }) {
  const t = useTranslations("profile");
  const [state, setState] = useState<"idle" | "busy" | "done" | "again">("idle");

  async function rain() {
    setState("busy");
    try {
      const res = await fetch("/api/coinrain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        already?: boolean;
      };
      if (data.ok) setState("done");
      // "already" is the once-per-day limit; anything else is a transient
      // failure and must leave the button usable instead of locking it.
      else if (data.already) setState("again");
      else setState("idle");
      if (data.ok) {
        // little coin-shower effect
        for (let i = 0; i < 12; i += 1) {
          const coin = document.createElement("span");
          // Mirror of the Coin component's default look (Mint, owner decision
          // 2026-10-02). The single cssText assignment used to WIPE the
          // width/height set just before it, so every sprite rendered 0x0 —
          // the box size now lives inside the one style string.
          coin.className = "bcoin bcoin-a";
          coin.innerHTML = '<span class="bcoin-face">B</span>';
          const px = 14 + Math.random() * 14;
          coin.style.cssText = `position:fixed;left:${10 + Math.random() * 80}vw;top:-2rem;width:${px}px;height:${px}px;font-size:${px * 0.52}px;pointer-events:none;z-index:9999;transition:top 1.4s ease-in,opacity 1.4s;`;
          document.body.append(coin);
          requestAnimationFrame(() => {
            coin.style.top = "100vh";
            coin.style.opacity = "0";
          });
          window.setTimeout(() => coin.remove(), 1600);
        }
      }
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={rain}
      disabled={state === "busy" || state === "done" || state === "again"}
      className="btn btn-ghost btn-sm"
      title={t("coinRainHint")}
    >
      {state === "done" || state === "again" ? (<><Coin size={13} /> ✓</>) : (<><Coin size={13} /> {t("coinRain")}</>)}
    </button>
  );
}
