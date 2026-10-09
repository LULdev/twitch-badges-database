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

/** The audience filter options for a push fan-out (see fetchPushTargets). */
export interface PushAudienceOptions {
  /** Recap pushes: only subscriptions that have not opted out (0045). */
  recapOnly?: boolean;
  /** This payload IS a jackpot alert: it reaches every subscriber, including
   *  the ones on "jackpot only" (0071). Generic broadcasts omit this and are
   *  filtered to exclude jackpot-only subscribers. */
  jackpot?: boolean;
}

/**
 * The subscription set one fan-out reaches. Exported because it is the whole
 * filter contract (0045 recap opt-out, 0071 jackpot-only) — the e2e script
 * asserts it against throwaway rows without sending a single push.
 *
 * Paged: PostgREST caps one response at 1000 rows, so a single select would
 * silently notify an arbitrary 1000 subscribers and only ever see their dead
 * endpoints.
 */
export async function fetchPushTargets(
  opts: PushAudienceOptions = {},
): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> {
  const supabase = createAdminClient();
  type Subscription = { endpoint: string; p256dh: string; auth: string };
  const subscriptions: Subscription[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .order("endpoint")
      .range(offset, offset + 999);
    if (opts.recapOnly) query = query.eq("recap", true);
    // A "jackpot only" subscriber asked to be excluded from everything except
    // jackpot alerts — the flag's whole point is that this one filter reaches
    // them and no other does.
    if (!opts.jackpot) query = query.eq("jackpot_only", false);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as Subscription[];
    subscriptions.push(...page);
    if (page.length < 1000) break;
  }
  return subscriptions;
}

/** Fan out a web push to every stored subscription; prunes dead endpoints.
 *  `recapOnly` filters to subscriptions that have not opted out of the daily
 *  and weekly arcade recaps (0045); `jackpot` marks a jackpot alert, which is
 *  the one payload that also reaches "jackpot only" subscribers (0071) —
 *  every other broadcast skips them. */
export async function sendPushToAll(
  payload: PushPayload,
  opts: PushAudienceOptions = {},
): Promise<PushResult> {
  if (!pushConfigured()) {
    return { sent: 0, failed: 0, configured: false };
  }

  const subscriptions = await fetchPushTargets(opts);

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
  // The wall-clock cap: 25 s of fan-out fits the cron's 60 s budget only while
  // the subscriber count is small, and an invocation killed mid-fan-out loses the
  // heartbeat, the prune and the badgebase half. Beyond ~500 subscribers the
  // oldest batches are silently skipped instead.
  const DEADLINE = Date.now() + 25_000;
  for (let i = 0; i < subscriptions.length; i += BATCH) {
    if (i > 0 && Date.now() > DEADLINE) {
      console.warn(
        `[push] wall-clock cap reached after ${i}/${subscriptions.length} subscriptions — skipping the rest`,
      );
      break;
    }
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
    const supabase = createAdminClient();
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
  // `kind` and `payload.tag` are PROVENANCE, not a feature: /notifications renders
  // title, body, url and date only, and nothing reads the tag (the service
  // worker's collapse tag comes from the push JSON, not this row). They are kept
  // deliberately — the row says what the alert was and how it was grouped — but a
  // future change that wants to filter or de-duplicate on them must first surface
  // them, and there are no translated labels for the kind values today.
  const { error } = await supabase.from("notifications").insert({
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    payload: { tag: payload.tag ?? null },
  });
  if (error) throw error;
}
