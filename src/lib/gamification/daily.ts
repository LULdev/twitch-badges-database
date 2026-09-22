import { createAdminClient } from "@/lib/supabase/admin";
import { award, bumpCoins, getProgress, logActivity } from "./xp";
import { evaluateAchievements } from "./achievements";

/**
 * Daily login bonus: +10 XP (+5 per streak day, capped at +50) and +50 coins.
 * One claim per UTC day.
 */
export async function claimDaily(userId: string): Promise<
  { ok: false; reason: "already" } | { ok: true; xp: number; coins: number; streak: number }
> {
  const supabase = createAdminClient();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Atomic compare-and-set gate: of two parallel claims exactly one wins the
  // row, so the bonus cannot be collected twice. Returns -1 when today's bonus
  // was already taken, otherwise the new streak length.
  const claimed = await supabase.rpc("claim_daily_gate", {
    p_user_id: userId,
    p_today: todayStr,
  });
  if (claimed.error) throw claimed.error;
  const streak = Number(claimed.data ?? -1);
  if (streak < 0) return { ok: false, reason: "already" };

  const bonus = Math.min(50, (streak - 1) * 5);
  const xp = 10 + bonus;
  const coins = 50 + Math.min(250, (streak - 1) * 25);

  await award(userId, {
    xp,
    coins,
    source: "daily",
    feedKind: "daily",
    feedTitle: `claimed the daily bonus (day ${streak} streak)`,
    payload: { streak, bonus },
  });

  return { ok: true, xp, coins, streak };
}

/**
 * Coin stealing via share link. The VICTIM configures price / max amount;
 * chance depends on the level difference between thief and victim.
 * Flood check: 5 minutes between attempts on the same victim, max 6/hour.
 */
export interface StealSettings {
  enabled: boolean;
  price: number; // what an attempt costs the thief
  maxAmount: number; // upper bound per successful heist
}

export const STEAL_DEFAULTS: StealSettings = {
  enabled: true,
  price: 100,
  maxAmount: 250,
};

export async function attemptSteal(
  thiefId: string,
  victimUsername: string,
): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      success: boolean;
      stolen: number;
      cost: number;
      chance: number;
      balance: number;
    }
> {
  const supabase = createAdminClient();

  // The username arrives from the client and is used as a LIKE pattern, so the
  // wildcards `%` and `_` must be escaped — otherwise `%` (or `_`) matches an
  // arbitrary victim instead of the one the caller named.
  const victimPattern = victimUsername
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const { data: victimProfile } = await supabase
    .from("profiles")
    .select("id, username, steal_enabled, steal_price, steal_max")
    .ilike("username", victimPattern)
    .maybeSingle();
  if (!victimProfile || !victimProfile.id) return { ok: false, error: "Victim not found." };
  if (victimProfile.id === thiefId) return { ok: false, error: "You cannot steal from yourself." };

  const settings: StealSettings = {
    enabled: victimProfile.steal_enabled ?? STEAL_DEFAULTS.enabled,
    price: Math.max(0, victimProfile.steal_price ?? STEAL_DEFAULTS.price),
    maxAmount: Math.max(10, victimProfile.steal_max ?? STEAL_DEFAULTS.maxAmount),
  };
  if (!settings.enabled) return { ok: false, error: "This collector disabled stealing." };

  const thief = await getProgress(thiefId);
  if (thief.coins < settings.price) {
    return { ok: false, error: `An attempt costs ${settings.price} coins.` };
  }

  // Flood checks: one attempt per victim per 5 min, max 6 victims per hour.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count: recentPair } = await supabase
    .from("steal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("thief_id", thiefId)
    .eq("victim_id", victimProfile.id)
    .gte("created_at", fiveMinAgo);
  if ((recentPair ?? 0) > 0) {
    return { ok: false, error: "Flood check: wait 5 minutes between attempts on the same collector." };
  }
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recentHour } = await supabase
    .from("steal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("thief_id", thiefId)
    .gte("created_at", hourAgo);
  if ((recentHour ?? 0) >= 6) {
    return { ok: false, error: "Flood check: max 6 steal attempts per hour." };
  }

  const victim = await getProgress(victimProfile.id);
  if (victim.coins <= 0) return { ok: false, error: "Victim has no coins to steal." };

  // Success chance: 50% base ± 1% per level difference, clamped 20–80%.
  const chance = Math.min(0.8, Math.max(0.2, 0.5 + (thief.level - victim.level) * 0.01));
  const success = Math.random() < chance;

  const stealable = Math.min(settings.maxAmount, Math.floor(victim.coins * 0.1), victim.coins);
  const stolen = success ? Math.max(1, Math.floor(stealable * (0.5 + Math.random() * 0.5))) : 0;

  const { error: attemptError } = await supabase.from("steal_attempts").insert({
    thief_id: thiefId,
    victim_id: victimProfile.id,
    cost: settings.price,
    coins: stolen,
    success,
  });
  if (attemptError) throw attemptError;

  // Thief pays the attempt cost; the victim keeps it. Both coin moves are
  // atomic deltas — writing a balance read earlier would discard whatever the
  // players earned in the meantime — and the counters move in one statement
  // for the same reason.
  await bumpCoins(thiefId, -settings.price + stolen);
  await supabase.rpc("bump_counters", {
    p_user_id: thiefId,
    p_deltas: {
      steals_successful: success ? 1 : 0,
      steals_failed: success ? 0 : 1,
    },
  });

  await bumpCoins(victimProfile.id, -stolen + (success ? 0 : settings.price));
  await supabase.rpc("bump_counters", {
    p_user_id: victimProfile.id,
    p_deltas: { times_robbed: 1 },
  });

  const thiefProfile = await supabase
    .from("profiles")
    .select("username")
    .eq("id", thiefId)
    .maybeSingle()
    .then(({ data }) => data?.username ?? "someone");

  await logActivity({
    userId: thiefId,
    kind: success ? "steal" : "steal_defended",
    title: success
      ? `stole ${stolen.toLocaleString("en")} coins from ${victimProfile.username}`
      : `failed to steal from ${victimProfile.username} — attempt cost ${settings.price} coins`,
    coinsAmount: success ? stolen : -settings.price,
    payload: { victim: victimProfile.username, stolen, cost: settings.price, chance },
  });

  await evaluateAchievements(thiefId).catch(() => undefined);
  await evaluateAchievements(victimProfile.id).catch(() => undefined);

  const balance = Math.max(0, thief.coins - settings.price + stolen);
  return { ok: true, success, stolen, cost: settings.price, chance, balance };
}

/** Coin rain easter egg: a visitor gifts the profile owner 1 coin (once/day). */
export async function coinRain(
  giverId: string | null,
  profileOwnerId: string,
): Promise<{ ok: boolean; already?: boolean }> {
  const supabase = createAdminClient();

  // The id arrives from the client — verify it is a real profile before it
  // reaches getProgress(), which would try to upsert user_progress against the
  // foreign key and turn a bad request into a 500.
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileOwnerId)
    .maybeSingle();
  if (!ownerProfile) return { ok: false };

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase
    .from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "coin_rain")
    .eq("user_id", profileOwnerId)
    .gte("created_at", since)
    .contains("payload", { giver: giverId ?? "anonymous" });
  if ((count ?? 0) > 0) return { ok: false, already: true };

  // Atomic +1: an absolute write would discard any award that landed between
  // the read and the write.
  await bumpCoins(profileOwnerId, 1);

  await logActivity({
    userId: profileOwnerId,
    kind: "coin_rain",
    title: "received a coin rain (+1 coin)",
    coinsAmount: 1,
    payload: { role: "receiver", giver: giverId ?? "anonymous" },
  });
  if (giverId) {
    await logActivity({
      userId: giverId,
      kind: "coin_rain",
      title: "sent a coin rain (+1 coin to the collector)",
      coinsAmount: 0,
      payload: { role: "giver", receiver: profileOwnerId },
    });
  }
  await evaluateAchievements(profileOwnerId).catch(() => undefined);
  return { ok: true };
}
