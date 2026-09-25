import { createAdminClient } from "@/lib/supabase/admin";
import { authUserId, ipHashFromRequest } from "@/lib/gamification/session";
import { isUserBanned } from "@/lib/admin";

export const dynamic = "force-dynamic";

const EMOJIS = ["like", "love", "laugh", "fire", "wow"];

/** Toggle an emoji reaction on a blog post (one per IP per emoji). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { slug?: string; emoji?: string }
    | null;
  if (!body?.slug || !EMOJIS.includes(String(body.emoji))) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: post } = await supabase
    .from("blog_posts")
    .select("id")
    .eq("slug", body.slug)
    .maybeSingle();
  if (!post) return Response.json({ error: "post not found" }, { status: 404 });

  const ipHash = ipHashFromRequest(request);
  const userId = await authUserId();
  if (userId && (await isUserBanned(userId))) {
    return Response.json({ error: "banned" }, { status: 403 });
  }

  const { data: existing, error: lookupError } = await supabase
    .from("blog_reactions")
    .select("id")
    .eq("post_id", post.id)
    .eq("ip_hash", ipHash)
    .eq("emoji", body.emoji)
    .maybeSingle();

  // Destructuring only `data` meant a failed lookup fell through to the INSERT,
  // where the (post_id, ip_hash, emoji) unique constraint turned the race into a
  // 500 carrying the raw Postgres message.
  if (lookupError) {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }

  if (existing) {
    await supabase.from("blog_reactions").delete().eq("id", existing.id);
    return Response.json({ ok: true, removed: true });
  }
  const { error } = await supabase.from("blog_reactions").insert({
    post_id: post.id,
    user_id: userId,
    ip_hash: ipHash,
    emoji: body.emoji,
  });
  if (error) {
    // Lost a race with a concurrent identical reaction. The row is there, which
    // is what the caller asked for — report it as added rather than 500 on it.
    if (error.code !== "23505") {
      console.warn("[blog-react] reaction failed:", error.message);
      return Response.json({ error: "reaction failed" }, { status: 500 });
    }
  }
  return Response.json({ ok: true, added: true });
}
