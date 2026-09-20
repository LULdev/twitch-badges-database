import { createAdminClient } from "@/lib/supabase/admin";
import { authUserId, ipHashFromRequest } from "@/lib/gamification/session";

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

  const { data: existing } = await supabase
    .from("blog_reactions")
    .select("id")
    .eq("post_id", post.id)
    .eq("ip_hash", ipHash)
    .eq("emoji", body.emoji)
    .maybeSingle();

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
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, added: true });
}
