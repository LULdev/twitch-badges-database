"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "@/i18n/navigation";

/**
 * Anonymous visitor beacon.
 *
 * ONE row per page view. The mount call creates the visit row and the id comes
 * back; the `pagehide` call then attaches the time spent to that same row
 * instead of writing a second one. (Both used to insert, so every page view
 * produced two rows and every hit metric read ~2×.) `navigator.sendBeacon` is
 * still what carries the duration — a `fetch` in an unload handler is dropped by
 * the browser.
 *
 * Deliberately quiet: nothing is sent when the browser reports Do Not Track
 * (the endpoint honours the same header), the request never blocks rendering,
 * and every failure is swallowed.
 */
export default function AnalyticsBeacon({ locale }: { locale: string }) {
  const pathname = usePathname();
  const startedAt = useRef<number>(0);
  const enteredAt = useRef<number>(0);

  useEffect(() => {
    // `pathname` from next-intl/navigation is already locale-stripped, so the
    // stored path stays comparable across languages (/de/badges and /en/badges
    // are one page, not two).
    const path = pathname || "/";
    enteredAt.current = Date.now();
    // Per-view id, captured in THIS effect closure. A ref shared across views let a
    // slow mount response from the page just left behind overwrite the new view's
    // id, so its pagehide updated the wrong row (or none) — the new view then got
    // two rows while the old row kept the duration.
    let viewId: number | null = null;

    const payload = (durationS?: number) =>
      JSON.stringify({
        path,
        locale,
        referrerHost: safeReferrerHost(),
        screenW: typeof window !== "undefined" ? window.screen?.width : undefined,
        tzOffsetMins: new Date().getTimezoneOffset(),
        durationS,
        id: viewId ?? undefined,
      });

    const send = async (durationS?: number) => {
      try {
        const body = payload(durationS);
        if (durationS !== undefined && typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
          return;
        }
        const res = await fetch("/api/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { id?: number } | null;
        if (typeof data?.id === "number") viewId = data.id;
      } catch {
        // A beacon failure is never worth surfacing.
      }
    };

    startedAt.current = Date.now();
    void send();

    const onHide = () => {
      const seconds = Math.round((Date.now() - enteredAt.current) / 1000);
      // Sub-second visits are reloads and prefetches; they would drag the average
      // duration toward zero. Nothing is sent: the mount row already counted the
      // view, and a duration-less second beacon would only add a duplicate row.
      if (seconds <= 0) return;
      void send(seconds);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [pathname, locale]);

  return null;
}

/** Only the host of the referrer leaves the browser — never the full URL. */
function safeReferrerHost(): string {
  try {
    if (!document.referrer) return "";
    const url = new URL(document.referrer);
    // Same-site navigation is not a referral worth recording.
    if (url.host === window.location.host) return "";
    return url.host;
  } catch {
    return "";
  }
}