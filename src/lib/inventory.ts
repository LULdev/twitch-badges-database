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

  const { data: catalog, error: catalogError } = await supabase
    .from("badges")
    .select("id,set_id,version")
    .neq("status", "removed");
  if (catalogError) throw catalogError;

  const byKey = new Map<string, string>();
  for (const row of (catalog ?? []) as Array<{
    id: string;
    set_id: string;
    version: string;
  }>) {
    byKey.set(`${row.set_id}:${row.version}`, row.id);
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

  // Badge-unlock rewards: 1,000 XP + 500 coins per newly claimed badge,
  // one public feed entry each (aggregated into a single progress update).
  if (toAdd.length > 0) {
    const { award, logActivity } = await import("./gamification/xp");
    const catalogRows = (catalog ?? []) as unknown as Array<{ id: string; slug: string; title: string }>;
    const addedBadges = catalogRows.filter((row) => toAdd.includes(row.id));
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
    await award(userId, {
      xp: addedBadges.length * 1000,
      coins: addedBadges.length * 500,
      source: "badge_claims",
      skipAchievements: false,
    });
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

  // Keep profile Twitch metadata fresh (avatar / display name / creation).
  await supabase
    .from("profiles")
    .update({
      display_name: perfil.displayName,
      avatar_url: perfil.profileImageURL,
      twitch_id: perfil.id,
      twitch_created_at: perfil.createdAt ?? null,
    })
    .eq("id", userId);

  // Best-effort potat.app enrichment: level, potatoes, first-seen, color and
  // cross-platform connections go straight onto the public profile.
  let potatEnriched = false;
  try {
    const potat = await fetchPotatUser(username, 0);
    if (potat) {
      const { error: potatError } = await supabase
        .from("profiles")
        .update({
          potat_level: potat.level,
          potatoes: potat.potatoes,
          potat_first_seen: potat.firstSeen,
          potat_connections: potat.connections,
        })
        .eq("id", userId);
      if (!potatError) potatEnriched = true;
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
