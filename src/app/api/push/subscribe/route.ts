import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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

  // Attach to the logged-in profile when present (anonymous opt-in allowed).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user?.id ?? null,
      endpoint,
      p256dh,
      auth,
      user_agent: body?.userAgent ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
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
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
