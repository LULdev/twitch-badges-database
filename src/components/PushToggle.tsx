"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type PushState = "unsupported" | "off" | "enabling" | "on" | "denied";

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

export default function PushToggle() {
  const t = useTranslations("notifications");
  const [state, setState] = useState<PushState>("off");
  const [testSent, setTestSent] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      const timer = setTimeout(() => setState("unsupported"), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((registration) =>
        registration.pushManager.getSubscription().then((subscription) => {
          if (cancelled) return;
          if (subscription) setState("on");
          else if (Notification.permission === "denied") setState("denied");
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

      const registration = await navigator.serviceWorker.ready;
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
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
        await subscription.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  async function sendTest() {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("Twitch Badges Database", {
      body: t("testSent"),
      icon: "/icon-192.png",
      tag: "tbd-test",
    });
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "on" ? (
        <>
          <span className="chip chip-active pointer-events-none">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            {t("enabled")}
          </span>
          <button type="button" className="btn btn-secondary text-xs" onClick={sendTest}>
            {testSent ? t("testSent") : t("test")}
          </button>
          <button type="button" className="btn btn-ghost text-xs" onClick={disable}>
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
          className="btn btn-primary text-xs"
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
  );
}
