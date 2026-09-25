import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserBanned } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Only public HTTPS push-service endpoints are accepted. */
function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    host.startsWith("[")
  ) {
    return false;
  }
  return host.includes(".");
}

interface SubscriptionPayload {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | SubscriptionPayload
    | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: "invalid subscription" }, { status: 400 });
  }

  // The keys are cryptographic material: a truncated one is garbage that fails
  // silently at every broadcast, so oversized values are rejected outright.
  // `user_agent` is informational and merely truncated.
  if (p256dh.length > 512 || auth.length > 128) {
    return Response.json({ error: "invalid subscription keys" }, { status: 400 });
  }
  const userAgent = body?.userAgent?.slice(0, 300) ?? null;

  // The endpoint is later fetched by the push service server-side, so it must
  // be a real public HTTPS URL — not an internal host, a redirector or an
  // unbounded string (SSRF / storage abuse).
  if (endpoint.length > 512 || !isAllowedPushEndpoint(endpoint)) {
    return Response.json({ error: "invalid endpoint" }, { status: 400 });
  }

  // Attach to the logged-in profile when present (anonymous opt-in allowed).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A banned member is stopped at every mutating route (see `isUserBanned`'s
  // docblock in lib/admin.ts) — this one was missed, so a ban did not stop a
  // banned browser from subscribing and continuing to receive broadcasts.
  if (user && (await isUserBanned(user.id))) {
    return Response.json({ error: "banned" }, { status: 403 });
  }

  const admin = createAdminClient();

  // An anonymous request must not be able to detach someone else's browser:
  // re-registering an owned endpoint without a session is refused.
  const { data: existing, error: lookupError } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  // Fail CLOSED: the ownership guard is worth nothing if a failed lookup lets the
  // upsert below rewrite `user_id` to the caller's (null for an anonymous
  // request), detaching someone else's browser.
  if (lookupError) {
    return Response.json({ error: "subscription lookup failed" }, { status: 500 });
  }
  if (existing?.user_id && existing.user_id !== user?.id) {
    return Response.json({ error: "endpoint already registered" }, { status: 409 });
  }
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user?.id ?? null,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.warn("[push] subscribe failed:", error.message);
    return Response.json({ error: "subscription failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | SubscriptionPayload
    | null;
  const endpoint = body?.endpoint;
  if (!endpoint) {
    return Response.json({ error: "endpoint required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The admin client bypasses the push_self_delete RLS policy, so the
  // ownership check has to happen here: a signed-in caller may only remove
  // their own subscription, an anonymous caller only an unowned one. Deleting
  // by endpoint alone would let anyone who learns another browser's endpoint
  // URL unsubscribe it.
  const admin = createAdminClient();
  let query = admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  query = user ? query.eq("user_id", user.id) : query.is("user_id", null);
  const { error } = await query;
  if (error) {
    console.warn("[push] unsubscribe failed:", error.message);
    return Response.json({ error: "unsubscribe failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
