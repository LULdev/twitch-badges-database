import { createAdminClient } from "@/lib/supabase/admin";

const DEDUP_WINDOW_MS = 5 * 60_000; // reload block on all view counters

/**
 * Record a profile visit with a 5-minute per-IP dedup and bump the counter.
 * Returns true when the visit counted (new within the window).
 */
export async function recordProfileVisit(
  profileId: string,
  visitorId: string | null,
  ipHash: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("profile_visits")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if ((count ?? 0) > 0) return false;

  const { error } = await supabase
    .from("profile_visits")
    .insert({ profile_id: profileId, visitor_id: visitorId, ip_hash: ipHash });
  if (error) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return false;

  // Atomic increment: reading view_count and writing it back lost one
  // increment whenever two visitors arrived inside the same window. The RPC's
  // error is inspected because a visitor whose counter never moved must not be
  // reported as counted.
  const { error: bumpError } = await supabase.rpc("bump_view_count", {
    p_profile_id: profileId,
  });
  return !bumpError;
}

/** Blog view with the same 5-minute per-IP dedup. Returns true when counted. */
export async function recordBlogView(
  postId: string,
  ipHash: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  // `blog_views` is (post_id, ip_hash, created_at) — it has no `id` column, so
  // counting on "id" was a 42703 whose error was discarded: `count` came back
  // null, `(count ?? 0) > 0` was always false and every reload inserted a row
  // (the 5-minute dedup never engaged, inflating the public view counter).
  const { count, error } = await supabase
    .from("blog_views")
    .select("post_id", { count: "exact", head: true })
    .eq("post_id", postId)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  // A failed dedup read must not be read as "no recent view" — that is exactly
  // how the counter was inflated. Refuse to count this view instead.
  if (error) return false;
  if ((count ?? 0) > 0) return false;

  const { error: insertError } = await supabase
    .from("blog_views")
    .insert({ post_id: postId, ip_hash: ipHash });
  return !insertError;
}
