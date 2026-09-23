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
  // Paged: PostgREST caps one response at 1000 rows, so a single select would
  // silently notify an arbitrary 1000 subscribers and only ever see their dead
  // endpoints.
  type Subscription = { endpoint: string; p256dh: string; auth: string };
  const subscriptions: Subscription[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .order("endpoint")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Subscription[];
    subscriptions.push(...page);
    if (page.length < 1000) break;
  }

  let sent = 0;
  let failed = 0;
  const deadEndpoints: string[] = [];

  // Bounded, because this runs inside the 60 s global cron BEFORE the badgebase
  // half: every subscription used to be hit at once with no timeout, so one
  // endpoint that accepts the connection and never answers would hold the whole
  // invocation until the platform killed it — and the day's authoritative
  // activity sync would never run. A per-request timeout plus batches keeps the
  // fan-out inside its share of the budget.
  const BATCH = 50;
  const TIMEOUT_MS = 5_000;
  for (let i = 0; i < subscriptions.length; i += BATCH) {
    await Promise.allSettled(
      subscriptions.slice(i, i + BATCH).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
            { TTL: 3600, urgency: "normal", timeout: TIMEOUT_MS },
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
  }

  if (deadEndpoints.length > 0) {
    // Chunked and checked: the endpoints are 100-200 character URLs, so one
    // `.in()` list for a mass notification builds a multi-KB query string the
    // gateway rejects — and the failure was invisible, so the dead rows survived
    // and were re-attempted and re-counted as failed on every later broadcast.
    for (let i = 0; i < deadEndpoints.length; i += 200) {
      const { error: pruneError } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", deadEndpoints.slice(i, i + 200));
      if (pruneError) {
        console.warn("[push] could not prune dead endpoints:", pruneError.message);
      }
    }
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
