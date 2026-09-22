import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Public live feed: latest activities across all users. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // `?limit=abc` used to produce NaN and fail the query with a 500; both
  // parameters fall back to their defaults unless they are real numbers.
  const cursorRaw = Number(url.searchParams.get("cursor"));
  const cursor = Number.isFinite(cursorRaw) && cursorRaw > 0 ? cursorRaw : 0;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(50, Math.max(5, Math.floor(limitRaw)))
    : 30;
  const supabase = createAdminClient();

  let query = supabase
    .from("activity_events")
    // Public endpoint: the internal user id and the raw payload blob are
    // not needed by the feed UI and must not be exposed.
    .select("id,username,avatar_url,kind,title,body,xp_amount,coins_amount,created_at")
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
