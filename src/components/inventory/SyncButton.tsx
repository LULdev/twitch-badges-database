"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function SyncButton() {
  const t = useTranslations("inventory");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel the pending reset on unmount: React 18 no longer warns about setting
  // state on an unmounted component, so nothing surfaced this.
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function sync() {
    setState("busy");
    try {
      const res = await fetch("/api/inventory/sync", { method: "POST" });
      if (res.status === 429) {
        // The server's per-user cooldown: the inventory was synced less than a
        // minute ago, so it IS current — showing the failure state for that would
        // tell the member something went wrong when nothing did.
        setState("done");
        router.refresh();
        if (resetTimer.current !== null) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setState("idle"), 4000);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? String(res.status));
      }
      setState("done");
      router.refresh();
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState("idle"), 4000);
    } catch (error) {
      console.warn("[inventory] sync failed", error);
      setState("error");
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-primary text-xs"
      onClick={sync}
      disabled={state === "busy"}
    >
      {state === "busy" && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-accent-ink/40 border-t-accent-ink" aria-hidden />
      )}
      {state === "busy"
        ? t("syncing")
        : state === "done"
          ? t("synced")
          : state === "error"
            ? t("syncFailed")
            : t("sync")}
    </button>
  );
}
