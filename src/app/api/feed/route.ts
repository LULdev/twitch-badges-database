import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Public live feed: latest activities across all users. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const cursor = Number(url.searchParams.get("cursor") ?? "0") || 0;
  const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") ?? "30")));
  const supabase = createAdminClient();

  let query = supabase
    .from("activity_events")
    .select("id,user_id,username,avatar_url,kind,title,body,xp_amount,coins_amount,payload,created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (cursor > 0) query = query.lt("id", cursor);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const events = (data ?? []) as Array<Record<string, unknown>>;
  const nextCursor = events.length > 0 ? Number(events[events.length - 1].id) : null;
  return Response.json(
    { events, nextCursor },
    { headers: { "cache-control": "no-store" } },
  );
}
