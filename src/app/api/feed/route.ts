import { createAdminClient } from "@/lib/supabase/admin";
import { getFeatures } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Public live feed: latest activities across all users. */
export async function GET(request: Request) {
  // The flag removes the feature, not just the nav link: with the feed switched
  // off the endpoint used to keep serving the full public feed at /api/feed.
  const features = await getFeatures();
  if (!features.feed) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  // `?limit=abc` used to produce NaN and fail the query with a 500; both
  // parameters fall back to their defaults unless they are real numbers.
  const cursorRaw = Number(url.searchParams.get("cursor"));
  const cursor = Number.isFinite(cursorRaw) && cursorRaw > 0 ? cursorRaw : 0;
  // ind-4: an absent `limit` must fall back to the documented 30. `Number(null)`
  // is 0 (a finite number), so the old clamp lifted an omitted parameter to 5 and
  // the default was unreachable. Only a *provided* value is clamped; absent or
  // non-numeric (`?limit=abc`) both take the default.
  const limitParam = url.searchParams.get("limit");
  const limitParsed = limitParam === null ? Number.NaN : Number(limitParam);
  const limit = Number.isFinite(limitParsed)
    ? Math.min(50, Math.max(5, Math.floor(limitParsed)))
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
  if (error) {
    console.warn("[feed] query failed:", error.message);
    return Response.json({ error: "feed unavailable" }, { status: 500 });
  }
  const events = (data ?? []) as Array<Record<string, unknown>>;
  const nextCursor = events.length > 0 ? Number(events[events.length - 1].id) : null;
  return Response.json(
    { events, nextCursor },
    { headers: { "cache-control": "no-store" } },
  );
}
