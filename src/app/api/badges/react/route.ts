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
    const { error: deleteError } = await supabase
      .from("badge_reactions")
      .delete()
      .eq("id", existing.id);
    // A failed delete must not report a removal: the row survives, but the
    // client would drop the reaction from the UI (and its count) on ok:true.
    if (deleteError) {
      console.warn("[badge-react] reaction delete failed:", deleteError.message);
      return Response.json({ error: "reaction failed" }, { status: 500 });
    }
    return Response.json({
      ok: true,
      removed: true,
      counts: await reactionCounts(supabase, badge.id),
    });
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
  return Response.json({
    ok: true,
    added: true,
    counts: await reactionCounts(supabase, badge.id),
  });
}

/** Authoritative per-reaction counts after a write. The client adopts these
 *  instead of doing ±1 arithmetic from a stale snapshot, so two tabs (or any
 *  concurrent visitor) can never diverge from the stored rows. Best-effort:
 *  on a read failure the key is omitted and the client keeps its snapshot. */
async function reactionCounts(
  supabase: ReturnType<typeof createAdminClient>,
  badgeId: string,
): Promise<Record<string, number> | undefined> {
  const counts: Record<string, number> = {};
  for (const reaction of REACTIONS) counts[reaction] = 0;
  const { data, error } = await supabase
    .from("badge_reactions")
    .select("reaction")
    .eq("badge_id", badgeId);
  if (error) {
    console.warn("[badge-react] count reload failed:", error.message);
    return undefined;
  }
  for (const row of data ?? []) {
    counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;
  }
  return counts;
}
