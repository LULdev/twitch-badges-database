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
  const { count, error } = await supabase
    .from("profile_visits")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  // A failed dedup read is not "no recent visit": treating it that way arms the
  // window twice and inflates the counter, the same way it inflated blog views.
  if (error) {
    console.warn("[visit] dedup read failed, not counting:", error.message);
    return false;
  }
  if ((count ?? 0) > 0) return false;

  // Same-bucket key for the partial unique index: two overlapping requests in the
  // same five-minute window collide on insert instead of both counting. The read
  // check above keeps the sliding-window behaviour; this closes the race, and a
  // 23505 that loses it is absorbed by the `return false` below.
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS);
  const { error: insertError } = await supabase
    .from("profile_visits")
    .insert({
      profile_id: profileId,
      visitor_id: visitorId,
      ip_hash: ipHash,
      dedup_bucket: bucket,
    });
  if (insertError) return false;

  // A successful insert already proves the profile exists (the foreign key
  // enforces it), so the extra lookup that used to sit here could only produce a
  // contradictory answer: "not counted" while the visit row was already stored
  // and the five-minute window therefore armed.
  //
  // Atomic increment: reading view_count and writing it back lost one increment
  // whenever two visitors arrived inside the same window.
  const { error: bumpError } = await supabase.rpc("bump_view_count", {
    p_profile_id: profileId,
  });
  if (bumpError) {
    console.warn("[visit] counter bump failed:", bumpError.message);
    return false;
  }
  return true;
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
  // how the counter was inflated. Refuse to count this view instead, and say so:
  // a persistent error here would otherwise drop every view silently.
  if (error) {
    console.warn("[visit] blog dedup read failed, not counting:", error.message);
    return false;
  }
  if ((count ?? 0) > 0) return false;

  // The same fix as a profile visit: a fixed bucket on top of the sliding read
  // check, so two overlapping views cannot both count.
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS);
  const { error: insertError } = await supabase
    .from("blog_views")
    .insert({ post_id: postId, ip_hash: ipHash, dedup_bucket: bucket });
  return !insertError;
}
