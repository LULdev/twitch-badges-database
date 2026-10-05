"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type PushState = "unsupported" | "off" | "idle" | "enabling" | "on" | "denied";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * `navigator.serviceWorker.ready` never rejects when the worker cannot
 * activate — a stale registration left over from an update can leave it
 * pending forever. Without the race the enable button would sit on "enabling"
 * with no way back; the timeout turns the hang into the normal failure path.
 */
function serviceWorkerReady(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("service worker not ready")), timeoutMs),
    ),
  ]);
}

export default function PushToggle() {
  const t = useTranslations("notifications");
  const [state, setState] = useState<PushState>("off");
  const [testSent, setTestSent] = useState(false);
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel the pending state update on unmount: React 18 no longer warns about
  // setting state on an unmounted component, so nothing surfaced this.
  useEffect(
    () => () => {
      if (testTimer.current !== null) clearTimeout(testTimer.current);
    },
    [],
  );
  const [error, setError] = useState(false);
  // Recap opt-out (migration 0045): endpoint-scoped, loaded once subscribed.
  const [recap, setRecap] = useState(true);
  const [recapBusy, setRecapBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      const timer = setTimeout(() => setState("unsupported"), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((registration) =>
        registration.pushManager.getSubscription().then(async (subscription) => {
          if (cancelled) return;
          if (subscription) {
            setState("on");
            // Load the stored recap flag; default true on any read failure.
            try {
              const res = await fetch(
                `/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`,
              );
              if (res.ok) {
                const data = (await res.json()) as { recap?: boolean };
                if (!cancelled) setRecap(data.recap ?? true);
              }
            } catch {
              // keep the default
            }
          } else if (Notification.permission === "denied") setState("denied");
          else setState("off");
        }),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (state === "unsupported" || state === "enabling") return;
    setState("enabling");
    setError(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "default") {
        setState("idle");
        return;
      }
      if (permission !== "granted") {
        setState("denied");
        return;
      }

      const vapidRes = await fetch("/api/push/vapid");
      const vapid = (await vapidRes.json()) as {
        configured: boolean;
        publicKey?: string;
      };
      if (!vapid.configured || !vapid.publicKey) {
        setState("off");
        setError(true);
        return;
      }

      const registration = await serviceWorkerReady();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
        });
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setState("on");
    } catch (caught) {
      console.warn("[push] enable failed", caught);
      setState("off");
      setError(true);
    }
  }

  async function disable() {
    try {
      const registration = await serviceWorkerReady();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // The server row and the browser subscription are two halves of one
        // switch. The DELETE used to gate the local unsubscribe, so a rejected
        // or failing request left a live subscription receiving pushes while
        // the UI already reported "off" — the worse of the two states.
        try {
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(subscription.toJSON()),
          });
        } catch {
          // Best effort: the local subscription is removed below regardless, and
          // the push service's next 410 lets the server prune the stale row.
        }
        await subscription.unsubscribe();
      }
    } catch (caught) {
      console.warn("[push] disable failed", caught);
      setError(true);
    } finally {
      setState("off");
    }
  }

  async function sendTest() {
    try {
      const registration = await serviceWorkerReady();
      await registration.showNotification("Twitch Badges Database", {
        body: t("testSent"),
        icon: "/icon-192.png",
        tag: "tbd-test",
      });
      setTestSent(true);
      if (testTimer.current !== null) clearTimeout(testTimer.current);
      testTimer.current = setTimeout(() => setTestSent(false), 3000);
    } catch (caught) {
      console.warn("[push] test notification failed", caught);
      setError(true);
    }
  }

  async function toggleRecap() {
    if (recapBusy) return;
    setRecapBusy(true);
    try {
      const registration = await serviceWorkerReady();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      const next = !recap;
      const res = await fetch("/api/push/subscribe", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, recap: next }),
      });
      // Follow the server's answer instead of guessing from local state.
      if (!res.ok) return;
      const data = (await res.json()) as { recap?: boolean };
      if (typeof data.recap === "boolean") setRecap(data.recap);
    } catch {
      // keep the old state on failure
    } finally {
      setRecapBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {state === "on" ? (
          <>
            <span className="chip chip-active pointer-events-none">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              {t("enabled")}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={sendTest}>
              {testSent ? t("testSent") : t("test")}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={disable}>
              {t("disable")}
            </button>
          </>
        ) : state === "unsupported" ? (
          <p className="text-sm text-muted">{t("notSupported")}</p>
        ) : state === "denied" ? (
          <p className="text-sm text-warning">{t("permissionDenied")}</p>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={enable}
            disabled={state === "enabling"}
          >
            {state === "enabling" ? t("enabling") : t("enable")}
          </button>
        )}
        {error ? (
          <p className="w-full text-xs text-danger" role="alert">
            {t("pushFailed")}
          </p>
        ) : null}
      </div>
      {state === "on" ? (
        <label className="flex items-start gap-2.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={recap}
            onChange={toggleRecap}
            disabled={recapBusy}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold text-foreground">{t("recapToggle")}</span>
            <br />
            {t("recapHint")}
          </span>
        </label>
      ) : null}
    </div>
  );
}
