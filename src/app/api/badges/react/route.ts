import { createAdminClient } from "@/lib/supabase/admin";
import { authUserId, ipHashFromRequest } from "@/lib/gamification/session";
import { isUserBanned } from "@/lib/admin";

export const dynamic = "force-dynamic";

const REACTIONS = ["like", "love", "fire", "poop", "sad", "dislike"];

/** Toggle a GIF reaction on a badge (one per IP per reaction). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { slug?: string; reaction?: string }
    | null;
  if (!body?.slug || !REACTIONS.includes(String(body.reaction))) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: badge } = await supabase
    .from("badges")
    .select("id")
    .eq("slug", body.slug)
    .maybeSingle();
  if (!badge) return Response.json({ error: "badge not found" }, { status: 404 });

  const ipHash = ipHashFromRequest(request);
  const userId = await authUserId();
  if (userId && (await isUserBanned(userId))) {
    return Response.json({ error: "banned" }, { status: 403 });
  }

  const { data: existing, error: lookupError } = await supabase
    .from("badge_reactions")
    .select("id")
    .eq("badge_id", badge.id)
    .eq("ip_hash", ipHash)
    .eq("reaction", body.reaction)
    .maybeSingle();

  // A failed lookup must not fall through to INSERT: the unique constraint
  // would turn the race into a 500 carrying the raw Postgres message.
  if (lookupError) {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }

  if (existing) {
    await supabase.from("badge_reactions").delete().eq("id", existing.id);
    return Response.json({ ok: true, removed: true });
  }
  const { error } = await supabase.from("badge_reactions").insert({
    badge_id: badge.id,
    ip_hash: ipHash,
    reaction: body.reaction,
  });
  if (error) {
    // Lost a race with a concurrent identical reaction. The row exists, which
    // is what the caller asked for — report added instead of a 500.
    if (error.code !== "23505") {
      console.warn("[badge-react] reaction failed:", error.message);
      return Response.json({ error: "reaction failed" }, { status: 500 });
    }
  }
  return Response.json({ ok: true, added: true });
}
