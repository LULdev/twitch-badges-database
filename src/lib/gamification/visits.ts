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
    .select("view_count")
    .eq("id", profileId)
    .maybeSingle();
  await supabase
    .from("profiles")
    .update({ view_count: (profile?.view_count ?? 0) + 1 })
    .eq("id", profileId);
  return true;
}

/** Blog view with the same 5-minute per-IP dedup. Returns true when counted. */
export async function recordBlogView(
  postId: string,
  ipHash: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("blog_views")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if ((count ?? 0) > 0) return false;

  const { error } = await supabase.from("blog_views").insert({ post_id: postId, ip_hash: ipHash });
  return !error;
}
