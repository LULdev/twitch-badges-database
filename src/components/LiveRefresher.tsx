"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Soft "real-time" layer: re-fetches the current server tree once a minute
 * so countdown-adjacent data (new badges, fresh stats) appears without a
 * manual reload. Heavy data still flows through the 15-minute cron sync.
 */
export default function LiveRefresher({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
