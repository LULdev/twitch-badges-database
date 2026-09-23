import { createAdminClient } from "./supabase/admin";
import { fetchUserBadges } from "./twitch/perfil";
import { fetchPotatUser } from "./twitch/potat";

export interface InventorySyncResult {
  owned: number;
  added: number;
  removed: number;
  unmatched: number;
  lastSyncedAt: string;
  potatEnriched: boolean;
}

/**
 * Replace the user's inventory with the live Twitch badge list resolved via
 * badges.blog (/api/perfil). Existing acquired_at timestamps are preserved;
 * badges that no longer resolve are dropped.
 */
export async function syncUserInventory(
  userId: string,
  username: string,
): Promise<InventorySyncResult> {
  const supabase = createAdminClient();
  const perfil = await fetchUserBadges(username, 0);

  // Paged: PostgREST returns at most 1000 rows per request, so a single select
  // would silently stop matching badges beyond that and report them as
  // unmatched ("not owned").
  const PAGE = 1000;
  const byKey = new Map<string, string>();
  // The rows themselves are kept too: the badge-unlock reward path below needs
  // id/slug/title, and re-querying them would double the round trips.
  const catalog: Array<{ id: string; slug: string; title: string }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("badges")
      .select("id,set_id,version,slug,title")
      .neq("status", "removed")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<{
      id: string;
      set_id: string;
      version: string;
      slug: string;
      title: string;
    }>;
    for (const row of page) {
      byKey.set(`${row.set_id}:${row.version}`, row.id);
      catalog.push({ id: row.id, slug: row.slug, title: row.title });
    }
    if (page.length < PAGE) break;
  }

  const ownedIds = new Set<string>();
  let unmatched = 0;
  for (const badge of perfil.badges) {
    const id = byKey.get(`${badge.setID}:${badge.version}`);
    if (id) {
      ownedIds.add(id);
    } else {
      unmatched += 1; // channel-scoped badges etc., not in the global catalog
    }
  }

  const { data: current, error: currentError } = await supabase
    .from("user_inventory")
    .select("badge_id")
    .eq("user_id", userId);
  if (currentError) throw currentError;

  const currentIds = new Set(
    (current ?? []).map((row) => (row as { badge_id: string }).badge_id),
  );

  // A failed or empty upstream response must not clear the inventory: an empty
  // badge list is far more likely to be a broken fetch than a collector who
  // owns nothing, and Twitch badges are never revoked from an account.
  // Only destructive when rows would actually be removed: a brand-new
  // collector whose badges are all channel-scoped legitimately owns none.
  if (ownedIds.size === 0 && currentIds.size > 0) {
    throw new Error(
      "perfil returned no owned badges — refusing to clear the inventory",
    );
  }

  const toAdd = [...ownedIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !ownedIds.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase.from("user_inventory").insert(
      toAdd.map((badgeId) => ({
        user_id: userId,
        badge_id: badgeId,
        source: "sync",
      })),
    );
    if (error) throw error;
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("user_inventory")
      .delete()
      .eq("user_id", userId)
      .in("badge_id", toRemove);
    if (error) throw error;
  }

  // Badge-unlock rewards: 1,000 XP + 500 coins per newly claimed badge, one
  // public feed entry each (aggregated into a single progress update).
  //
  // The payment is recorded BEFORE it happens, in the same table that decides
  // whether it happens: `badge_unlock_rewards` has (user_id, badge_id) as its key,
  // so claiming a row is what "this badge has not been paid yet" means. The
  // previous version paid for whatever was absent from `user_inventory`, which
  // made the reward a function of table state — and a member could delete those
  // rows (the grant and policy that allowed it are gone in migration 0033) and be
  // paid again for every badge they owned, without limit.
  if (toAdd.length > 0) {
    const { award, logActivity } = await import("./gamification/xp");

    // `ignoreDuplicates` plus a select returns only the rows that were actually
    // inserted, which is exactly the set of badges that had no reward yet.
    const { data: claimed, error: claimError } = await supabase
      .from("badge_unlock_rewards")
      .upsert(
        toAdd.map((badgeId) => ({ user_id: userId, badge_id: badgeId })),
        { onConflict: "user_id,badge_id", ignoreDuplicates: true },
      )
      .select("badge_id");
    if (claimError) throw claimError;

    const rewardIds = new Set(
      (claimed ?? []).map((row) => String((row as { badge_id: string }).badge_id)),
    );
    const addedBadges = catalog.filter((row) => rewardIds.has(row.id));
    for (const badge of addedBadges) {
      await logActivity({
        userId,
        kind: "badge_claim",
        title: `unlocked badge: ${badge.title}`,
        body: "New Twitch badge claimed — +1,000 XP, +500 coins.",
        xpAmount: 1000,
        coinsAmount: 500,
        payload: { badge: badge.slug },
      });
    }
    if (addedBadges.length > 0) {
      await award(userId, {
        xp: addedBadges.length * 1000,
        coins: addedBadges.length * 500,
        source: "badge_claims",
        skipAchievements: false,
      });
    }
  }

  const now = new Date().toISOString();
  const { error: stateError } = await supabase
    .from("user_sync_state")
    .upsert(
      {
        user_id: userId,
        owned_count: ownedIds.size,
        snapshot: {
          perfil_total: perfil.badges.length,
          unmatched_channel_badges: unmatched,
          display_name: perfil.displayName,
          avatar: perfil.profileImageURL,
          twitch_id: perfil.id,
        },
        last_synced_at: now,
      },
      { onConflict: "user_id" },
    );
  if (stateError) throw stateError;

  // Provider-owned identity metadata: avatar, twitch id and account creation are
  // refreshed on every sync. `display_name` is deliberately NOT in this patch —
  // it is member-editable (AccountSettings) and is the public profile heading, so
  // a sync writing it silently reverted a chosen name to the Twitch name.
  const profilePatch: Record<string, unknown> = {};
  if (perfil.profileImageURL) profilePatch.avatar_url = perfil.profileImageURL;
  if (perfil.id) profilePatch.twitch_id = perfil.id;
  if (perfil.createdAt) profilePatch.twitch_created_at = perfil.createdAt;
  if (Object.keys(profilePatch).length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);
    // Logged, not thrown: the badge inventory is what this sync exists for, and
    // failing the whole run over a cosmetic profile field would mark the
    // heartbeat as an error for something that self-heals on the next sync.
    if (profileError) console.warn("[inventory] profile update failed:", profileError.message);
  }

  // Seed `display_name` from Twitch only while it is still unset, so a first
  // sync populates it and a member's chosen name is never reverted. Conditional
  // in SQL (`.is(..., null)`) so it stays correct under concurrency.
  if (perfil.displayName) {
    const { error: nameError } = await supabase
      .from("profiles")
      .update({ display_name: perfil.displayName })
      .eq("id", userId)
      .is("display_name", null);
    if (nameError) console.warn("[inventory] display name seed failed:", nameError.message);
  }

  // Best-effort potat.app enrichment: level, potatoes, first-seen, color and
  // cross-platform connections go straight onto the public profile.
  let potatEnriched = false;
  try {
    const potat = await fetchPotatUser(username, 0);
    if (potat) {
      const potatPatch: Record<string, unknown> = {};
      if (potat.level !== null) potatPatch.potat_level = potat.level;
      if (potat.potatoes !== null) potatPatch.potatoes = potat.potatoes;
      if (potat.firstSeen !== null) potatPatch.potat_first_seen = potat.firstSeen;
      if (potat.connections.length > 0) potatPatch.potat_connections = potat.connections;
      if (Object.keys(potatPatch).length > 0) {
        const { error: potatError } = await supabase
          .from("profiles")
          .update(potatPatch)
          .eq("id", userId);
        if (!potatError) potatEnriched = true;
      }
    }
  } catch (error) {
    console.warn(
      "[inventory] potat enrichment failed:",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    owned: ownedIds.size,
    added: toAdd.length,
    removed: toRemove.length,
    unmatched,
    lastSyncedAt: now,
    potatEnriched,
  };
}
