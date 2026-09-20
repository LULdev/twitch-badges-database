import webpush from "web-push";
import { envOrNull } from "./env";
import { createAdminClient } from "./supabase/admin";

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured === null) {
    const publicKey = envOrNull("VAPID_PUBLIC_KEY");
    const privateKey = envOrNull("VAPID_PRIVATE_KEY");
    const subject = envOrNull("VAPID_SUBJECT");
    configured = Boolean(publicKey && privateKey && subject);
    if (configured) {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    }
  }
  return configured;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  configured: boolean;
}

/** Fan out a web push to every stored subscription; prunes dead endpoints. */
export async function sendPushToAll(payload: PushPayload): Promise<PushResult> {
  if (!pushConfigured()) {
    return { sent: 0, failed: 0, configured: false };
  }

  const supabase = createAdminClient();
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  const deadEndpoints: string[] = [];

  await Promise.allSettled(
    (subscriptions ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          { TTL: 3600, urgency: "normal" },
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        }
      }
    }),
  );

  if (deadEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  return { sent, failed, configured: true };
}

/** Record an in-app notification (feeds /notifications and the bell list). */
export async function recordNotification(
  payload: PushPayload & { kind: string },
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("notifications").insert({
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    payload: { tag: payload.tag ?? null },
  });
  if (error) throw error;
}
