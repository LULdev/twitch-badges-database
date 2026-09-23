import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserInventory } from "@/lib/inventory";
import { isUserBanned } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Per-user cooldown. Each call performs two third-party fetches (badges.blog
 * perfil, potat) plus a paged full-catalogue scan, and this route had no throttle
 * at all — the replay half of the old exploit is closed by the idempotent
 * `badge_unlock_rewards` claim, but the resource cost was still unbounded for a
 * member willing to loop it. `user_sync_state.last_synced_at` already records when
 * the last sync ran, so the guard needs no new state.
 */
const SYNC_THROTTLE_MS = 60_000;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }
  if (await isUserBanned(user.id)) {
    return Response.json({ error: "banned" }, { status: 403 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  const username = profile?.username;
  if (!username) {
    return Response.json({ error: "profile missing" }, { status: 404 });
  }

  // Claim the window ATOMICALLY before doing any work. A read-then-check raced
  // with itself — N concurrent POSTs all saw the same stale timestamp and all ran
  // the full sync — and because the stamp is written at the END of a successful
  // run, a failing sync never stamped at all, leaving the loop unbounded exactly
  // when the upstream was degraded.
  const admin = createAdminClient();
  const now = new Date();
  const cutoff = new Date(now.getTime() - SYNC_THROTTLE_MS).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("user_sync_state")
    .update({ last_synced_at: now.toISOString() })
    .eq("user_id", user.id)
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .select("user_id");
  if (claimError) {
    return Response.json({ error: "could not check the sync window" }, { status: 503 });
  }
  let holdsClaim = Boolean(claimed && claimed.length > 0);
  if (!holdsClaim) {
    // No row to claim means the member has never synced — and the UPDATE cannot
    // match a row that does not exist, so a brand-new account's burst was
    // unthrottled, as was a FIRST sync that kept failing (the row is created only
    // at the end of a successful run). Create the row as the claim instead: a
    // conflict means a row exists, i.e. someone else holds the window.
    const { data: created, error: createError } = await admin
      .from("user_sync_state")
      .upsert(
        { user_id: user.id, last_synced_at: now.toISOString() },
        { onConflict: "user_id", ignoreDuplicates: true },
      )
      .select("user_id");
    if (createError) {
      return Response.json({ error: "could not check the sync window" }, { status: 503 });
    }
    holdsClaim = Boolean(created && created.length > 0);
  }
  if (!holdsClaim) {
    const { data: state } = await admin
      .from("user_sync_state")
      .select("last_synced_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const elapsed = Date.now() - new Date(state?.last_synced_at ?? 0).getTime();
    return Response.json(
      {
        error: "synced recently",
        retryAfterSeconds: Math.max(1, Math.ceil((SYNC_THROTTLE_MS - elapsed) / 1000)),
      },
      { status: 429 },
    );
  }

  try {
    const result = await syncUserInventory(user.id, username);
    // pdat-5: `ok: true` used to be unconditional even when the potat
    // enrichment had failed (potatEnriched: false) — a partial sync looked
    // identical to a complete one. Surface the real outcome: a degraded sync is
    // still HTTP 200 (the badge list did sync), but the body says so.
    const degraded = !result.potatEnriched;
    return Response.json({ ok: !degraded, degraded, result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 502 },
    );
  }
}
