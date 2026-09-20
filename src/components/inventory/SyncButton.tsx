"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function SyncButton() {
  const t = useTranslations("inventory");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function sync() {
    setState("busy");
    try {
      const res = await fetch("/api/inventory/sync", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? String(res.status));
      }
      setState("done");
      router.refresh();
      setTimeout(() => setState("idle"), 4000);
    } catch (error) {
      console.warn("[inventory] sync failed", error);
      setState("error");
      setTimeout(() => setState("idle"), 4000);
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
