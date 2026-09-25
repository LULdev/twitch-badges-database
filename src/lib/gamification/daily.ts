import { createAdminClient } from "@/lib/supabase/admin";
import { award, bumpCoins, ensureProgress, getProgress, logActivity, readProgress } from "./xp";
import { evaluateAchievements } from "./achievements";
import { getEconomy } from "@/lib/settings";

/**
 * Daily login bonus. Base amounts and per-streak increments come from the admin
 * panel's economy settings; their defaults (+10 XP, +50 coins, +5 XP and +25
 * coins per streak day, capped at +50 and +250) reproduce exactly what this
 * used to hardcode. One claim per UTC day.
 */
export async function claimDaily(userId: string): Promise<
  { ok: false; reason: "already" } | { ok: true; xp: number; coins: number; streak: number }
> {
  const supabase = createAdminClient();
  const economy = await getEconomy();
  const todayStr = new Date().toISOString().slice(0, 10);

  // The gate only UPDATEs, so a user with no `user_progress` row would match 0
  // rows and be told today's bonus was already claimed on their first-ever
  // claim. ON CONFLICT DO NOTHING makes the row exist without touching it.
  await ensureProgress(userId);

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

  const bonus = Math.min(
    economy.streakXpCap,
    (streak - 1) * economy.streakXpPerDay,
  );
  const xp = economy.dailyXp + bonus;
  const coins =
    economy.dailyCoins +
    Math.min(economy.streakCoinsCap, (streak - 1) * economy.streakCoinsPerDay);

  try {
    await award(userId, {
      xp,
      coins,
      source: "daily",
      feedKind: "daily",
      feedTitle: `claimed the daily bonus (day ${streak} streak)`,
      payload: { streak, bonus },
    });
  } catch (error) {
    // The gate and the reward are two transactions. A failed award would spend the
    // whole day's bonus — the gate is committed, nothing was paid, and the retry is
    // answered "already" — so release the gate and rethrow; the client's retry then
    // succeeds. A release that itself fails is only logged: the original failure is
    // the one the caller must see.
    try {
      const release = await supabase.rpc("release_daily_gate", {
        p_user_id: userId,
        p_today: todayStr,
      });
      if (release.error) throw release.error;
    } catch (releaseError) {
      console.warn("[daily] could not release the gate after a failed award:", releaseError);
    }
    throw error;
  }

  return { ok: true, xp, coins, streak };
}

/**
 * Coin stealing via share link. The VICTIM configures price / max amount;
 * chance depends on the level difference between thief and victim.
 * Flood check: 5 minutes between attempts on the same victim, max 6/hour.
 */
/**
 * Stable failure codes for the steal flow: the API returns the English `error`
 * sentence for backwards compatibility, but the UI maps `code` through the
 * locale files so no server sentence renders raw under another language.
 */
export type StealErrorCode =
  | "notFound"
  | "self"
  | "victimDisabled"
  | "tooPoor"
  | "floodPair"
  | "floodHour"
  | "floodRace"
  | "victimBroke"
  | "disabled";

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
  | { ok: false; error: string; code: StealErrorCode }
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
  const economy = await getEconomy();

  // The username arrives from the client and is used as a LIKE pattern, so the
  // wildcards `%` and `_` must be escaped — otherwise `%` (or `_`) matches an
  // arbitrary victim instead of the one the caller named.
  const victimPattern = victimUsername
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    // PostgREST aliases `*` to `%` in like/ilike, so it has to be escaped exactly
    // like `%` — otherwise `a*` resolves the victim by prefix instead of by name,
    // which is the one thing this escaping exists to prevent.
    .replace(/\*/g, "\\*");
  const { data: victimProfile } = await supabase
    .from("profiles")
    .select("id, username, steal_enabled, steal_price, steal_max")
    .ilike("username", victimPattern)
    .maybeSingle();
  if (!victimProfile || !victimProfile.id) {
    return { ok: false, error: "Victim not found.", code: "notFound" };
  }
  if (victimProfile.id === thiefId) {
    return { ok: false, error: "You cannot steal from yourself.", code: "self" };
  }

  // A member's own configuration wins; the panel's economy settings are the
  // fallback for everyone who never set one.
  const settings: StealSettings = {
    enabled: victimProfile.steal_enabled ?? STEAL_DEFAULTS.enabled,
    price: Math.max(0, victimProfile.steal_price ?? economy.stealPrice),
    maxAmount: Math.max(10, victimProfile.steal_max ?? economy.stealMax),
  };
  if (!settings.enabled) {
    return { ok: false, error: "This collector disabled stealing.", code: "victimDisabled" };
  }

  const thief = await getProgress(thiefId);
  if (thief.coins < settings.price) {
    return { ok: false, error: `An attempt costs ${settings.price} coins.`, code: "tooPoor" };
  }

  // Flood checks: one attempt per victim per window, capped per hour.
  const floodMinutes = Math.max(0, economy.stealFloodMinutes);
  const fiveMinAgo = new Date(Date.now() - floodMinutes * 60_000).toISOString();
  const { count: recentPair } = await supabase
    .from("steal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("thief_id", thiefId)
    .eq("victim_id", victimProfile.id)
    .gte("created_at", fiveMinAgo);
  if ((recentPair ?? 0) > 0) {
    return {
      ok: false,
      error: `Flood check: wait ${floodMinutes} minutes between attempts on the same collector.`,
      code: "floodPair",
    };
  }
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recentHour } = await supabase
    .from("steal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("thief_id", thiefId)
    .gte("created_at", hourAgo);
  if ((recentHour ?? 0) >= economy.stealPerHour) {
    return {
      ok: false,
      error: `Flood check: max ${economy.stealPerHour} steal attempts per hour.`,
      code: "floodHour",
    };
  }

  // `readProgress`, never `getProgress`: the victim is only being targeted, and
  // getProgress INSERTS a user_progress row on miss — a service-role write on a
  // request that usually ends in "no coins", which inflated the public player
  // count and dragged the average level toward 1.
  const victim = await readProgress(victimProfile.id);
  if (!victim || victim.coins <= 0) {
    return { ok: false, error: "Victim has no coins to steal.", code: "victimBroke" };
  }

  // Success chance: 50% base ± 1% per level difference, clamped 20–80%.
  const chance = Math.min(0.8, Math.max(0.2, 0.5 + (thief.level - victim.level) * 0.01));
  const success = Math.random() < chance;

  const stealable = Math.min(settings.maxAmount, Math.floor(victim.coins * 0.1), victim.coins);
  const stolen = success ? Math.max(1, Math.floor(stealable * (0.5 + Math.random() * 0.5))) : 0;

  const { data: attempt, error: attemptError } = await supabase
    .from("steal_attempts")
    .insert({
      thief_id: thiefId,
      victim_id: victimProfile.id,
      cost: settings.price,
      coins: stolen,
      success,
    })
    .select("id")
    .maybeSingle();
  if (attemptError) throw attemptError;

  // Both flood checks above read BEFORE this row existed, so a parallel burst
  // can make every request observe the same empty window. Counting again now
  // that our row is in turns that into an optimistic guard: the losers undo
  // their attempt before a single coin has moved. (A truly atomic guard needs a
  // unique index on a time bucket, which is not in the schema.)
  const { count: racedPair } = await supabase
    .from("steal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("thief_id", thiefId)
    .eq("victim_id", victimProfile.id)
    .gte("created_at", fiveMinAgo);
  const { count: racedHour } = await supabase
    .from("steal_attempts")
    .select("id", { count: "exact", head: true })
    .eq("thief_id", thiefId)
    .gte("created_at", hourAgo);
  if ((racedPair ?? 0) > 1 || (racedHour ?? 0) > economy.stealPerHour) {
    if (attempt?.id != null) {
      // Same reasoning as the game-round cleanup: a surviving attempt row would
      // pollute the flood window for the next five minutes.
      const { error: voidError } = await supabase
        .from("steal_attempts")
        .delete()
        .eq("id", attempt.id);
      if (voidError) {
        console.warn("[steal] could not void the raced attempt:", voidError.message);
      }
    }
    return { ok: false, error: "Flood check: too many attempts at once.", code: "floodRace" };
  }

  // Thief pays the attempt cost; the victim keeps it. Both coin moves are
  // atomic deltas — writing a balance read earlier would discard whatever the
  // players earned in the meantime — and the counters move in one statement
  // for the same reason. Their errors are inspected: the round used to report
  // success while games_won/coins_won or the counter stayed behind.
  // Both balances move in ONE statement: as two `add_coins` calls an error
  // between them left the transfer half-applied while the flood window was
  // already consumed. The victim receives the attempt cost on BOTH outcomes —
  // that is what the anti-abuse design means: paying to harass has to benefit
  // the target. Only giving it back on a failure removed `price` from the
  // economy on every successful heist, a deflationary sink the victim sized
  // themselves via `steal_price`.
  const transferred = await supabase.rpc("apply_pair_deltas", {
    p_a: thiefId,
    p_a_delta: -settings.price + stolen,
    p_b: victimProfile.id,
    p_b_delta: -stolen + settings.price,
  });
  if (transferred.error) {
    // The attempt row already exists (the flood guards above need it). A failed
    // transfer moved no coins, so it must not consume the 5-minute or hourly
    // window either — void it before rethrowing, the same cleanup playGame
    // applies to a raced round.
    if (attempt?.id != null) {
      const { error: voidError } = await supabase
        .from("steal_attempts")
        .delete()
        .eq("id", attempt.id);
      if (voidError) {
        console.warn(
          "[steal] could not void the attempt after a failed transfer:",
          voidError.message,
        );
      }
    }
    throw transferred.error;
  }
  const pairRow = Array.isArray(transferred.data) ? transferred.data[0] : transferred.data;
  const balance = Number(
    (pairRow as { a_coins?: number } | null)?.a_coins ??
      Math.max(0, thief.coins - settings.price + stolen),
  );

  // Counters move only after BOTH coin moves. Throwing in between used to leave
  // the transfer half-applied — the thief charged, the victim not credited —
  // plus a five-minute lockout on a request whose coins had already moved. Now
  // the settlement is complete before anything can fail, and a counter problem
  // is reported instead of aborting a steal that did happen.
  const [thiefCounter, victimCounter] = await Promise.all([
    supabase.rpc("bump_counters", {
      p_user_id: thiefId,
      p_deltas: {
        steals_successful: success ? 1 : 0,
        steals_failed: success ? 0 : 1,
      },
    }),
    supabase.rpc("bump_counters", {
      p_user_id: victimProfile.id,
      p_deltas: { times_robbed: 1 },
    }),
  ]);
  if (thiefCounter.error || victimCounter.error) {
    console.warn(
      "[steal] counter update failed after the coins moved:",
      thiefCounter.error?.message ?? victimCounter.error?.message,
    );
  }

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

  // The RPC's returned balance, not one recomputed from the snapshot read
  // before the flood checks: any award that landed in between made the number
  // the UI shows wrong (and Math.max(0, …) masked it as zero).
  return { ok: true, success, stolen, cost: settings.price, chance, balance };
}

/**
 * Drop coin-rain gate rows older than the retention window. Only today's rows
 * are ever consulted (the primary key includes the UTC day), so anything older
 * is dead weight that would otherwise grow by one row per (profile, giver, day)
 * forever.
 */
export async function prunedCoinRainGate(olderThanDays = 7): Promise<number> {
  try {
    const supabase = createAdminClient();
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await supabase
      .from("coin_rain_gate")
      .delete()
      .lt("day", cutoff)
      .select("day");
    if (error) throw error;
    return data?.length ?? 0;
  } catch (error) {
    console.warn("[coin-rain] gate prune failed:", error);
    return 0;
  }
}

/** Coin rain easter egg: a visitor gifts the profile owner coins (once/day). */
export async function coinRain(
  giverId: string | null,
  profileOwnerId: string,
  /**
   * Identifies an anonymous giver. Without it every logged-out visitor shared
   * the single key "anonymous", so the first gift of the day locked out all
   * other visitors (and one person could gift every profile once).
   */
  anonymousKey?: string,
): Promise<{ ok: boolean; already?: boolean }> {
  const supabase = createAdminClient();
  const economy = await getEconomy();

  // The id arrives from the client — verify it is a real profile before the
  // gate insert below, whose foreign key would otherwise turn a bad request into
  // a 500.
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileOwnerId)
    .maybeSingle();
  if (!ownerProfile) return { ok: false };

  // Nothing used to stop a signed-in user raining on their own profile for a
  // free coin (the once-a-day key is the giver, so their own id matched, not
  // the anonymous key).
  if (giverId && giverId === profileOwnerId) return { ok: false };

  // Atomic once-per-day gate. The primary key on (owner, giver, UTC day) makes a
  // parallel burst collide instead of every request observing "no rain today".
  // It replaces a read-then-write on activity_events whose filter compared the
  // anonymous giver's IP hash against a payload value only ever written as
  // "anonymous" — so for logged-out visitors it never matched and every POST
  // awarded another coin. The hash cannot go into that table instead: it is
  // public-read.
  const day = new Date().toISOString().slice(0, 10);
  const giverKey = giverId ?? anonymousKey ?? "anonymous";
  // The owner must have a progress row before the coin is added: add_coins is a
  // silent zero-row no-op without one, so the gate row was consumed and the
  // client was told ok:true for a coin that never existed — and the retry then
  // answered already:true.
  await ensureProgress(profileOwnerId);
  const { error: gateError } = await supabase
    .from("coin_rain_gate")
    .insert({ owner_id: profileOwnerId, giver_key: giverKey, day });
  if (gateError) {
    // 23505 unique_violation: this giver already rained on this profile today.
    if (gateError.code === "23505") return { ok: false, already: true };
    throw gateError;
  }

  // Atomic +N: an absolute write would discard any award that landed between
  // the read and the write.
  const rain = Math.max(1, economy.coinRainCoins);
  try {
    await bumpCoins(profileOwnerId, rain);
  } catch (error) {
    // Release the gate. The row already claimed today, so a failed award burned
    // the day: the retry hit 23505 and answered already:true while the owner never
    // received the coin. Mirrors the claim_/release_ gate pair used by the daily
    // bonus and the wheel (migration 0034).
    await supabase
      .from("coin_rain_gate")
      .delete()
      .eq("owner_id", profileOwnerId)
      .eq("giver_key", giverKey)
      .eq("day", day);
    throw error;
  }

  await logActivity({
    userId: profileOwnerId,
    kind: "coin_rain",
    title: `received a coin rain (+${rain} coin${rain === 1 ? "" : "s"})`,
    coinsAmount: rain,
    payload: { role: "receiver", giver: giverId ?? "anonymous" },
  });
  if (giverId) {
    await logActivity({
      userId: giverId,
      kind: "coin_rain",
      title: `sent a coin rain (+${rain} coin${rain === 1 ? "" : "s"} to the collector)`,
      coinsAmount: 0,
      payload: { role: "giver", receiver: profileOwnerId },
    });
  }
  await evaluateAchievements(profileOwnerId).catch(() => undefined);
  return { ok: true };
}
