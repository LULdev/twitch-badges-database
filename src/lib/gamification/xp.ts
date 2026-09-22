import { createAdminClient } from "@/lib/supabase/admin";
import { levelFromXp } from "./levels";
import { evaluateAchievements } from "./achievements";

export interface ProgressRow {
  user_id: string;
  xp: number;
  coins: number;
  level: number;
  login_streak: number;
  best_login_streak: number;
  last_login_date: string | null;
  last_wheel_date: string | null;
  games_played: number;
  games_won: number;
  coins_won: number;
  coins_lost: number;
  wheel_spins: number;
  steals_successful: number;
  steals_failed: number;
  times_robbed: number;
  game_xp_today: number;
  game_xp_day: string | null;
  achievements_points: number;
}

export type FeedKind =
  | "xp"
  | "daily"
  | "badge_claim"
  | "wheel"
  | "game"
  | "achievement"
  | "steal"
  | "steal_defended"
  | "level_up"
  | "turbo_win"
  | "coin_rain"
  | "profile"
  | "first_login";

/** Public live-feed entry — every XP gain, game, achievement, steal … */
export async function logActivity(entry: {
  userId: string | null;
  kind: FeedKind;
  title: string;
  body?: string | null;
  xpAmount?: number | null;
  coinsAmount?: number | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    let username: string | null = null;
    let avatar: string | null = null;
    if (entry.userId) {
      const { data } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", entry.userId)
        .maybeSingle();
      username = data?.username ?? null;
      avatar = data?.avatar_url ?? null;
    }
    const { error } = await supabase.from("activity_events").insert({
      user_id: entry.userId,
      username,
      avatar_url: avatar,
      kind: entry.kind,
      title: entry.title,
      body: entry.body ?? null,
      xp_amount: entry.xpAmount ?? null,
      coins_amount: entry.coinsAmount ?? null,
      payload: entry.payload ?? null,
    });
    if (error) throw error;
  } catch (error) {
    console.warn("[feed] log failed:", error);
  }
}

export async function getProgress(userId: string): Promise<ProgressRow> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("user_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as ProgressRow;
  const inserted = await supabase
    .from("user_progress")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (inserted.data ?? {
    user_id: userId,
    xp: 0,
    coins: 0,
    level: 1,
    login_streak: 0,
    best_login_streak: 0,
    last_login_date: null,
    last_wheel_date: null,
    games_played: 0,
    games_won: 0,
    coins_won: 0,
    coins_lost: 0,
    wheel_spins: 0,
    steals_successful: 0,
    steals_failed: 0,
    times_robbed: 0,
    game_xp_today: 0,
    game_xp_day: null,
    achievements_points: 0,
  }) as ProgressRow;
}

export interface AwardOptions {
  xp?: number;
  coins?: number;
  source: string;
  feedTitle?: string;
  feedBody?: string | null;
  feedKind?: FeedKind;
  payload?: Record<string, unknown> | null;
  /** Game XP counts against the daily anti-farm cap (100 XP/day). */
  countsAsGameXp?: boolean;
  skipAchievements?: boolean;
}

export interface AwardResult {
  xpAwarded: number;
  coinsAwarded: number;
  level: number;
  leveledUp: boolean;
  newLevel: number;
  coins: number;
}

/**
 * Central XP/coin award: updates progress, applies the level curve, writes a
 * public feed entry for EVERY award and re-evaluates achievements.
 */
export async function award(
  userId: string,
  options: AwardOptions,
): Promise<AwardResult> {
  const supabase = createAdminClient();
  const current = await getProgress(userId);

  let xpAwarded = Math.max(0, Math.floor(options.xp ?? 0));
  const coinsAwarded = Math.floor(options.coins ?? 0);
  const today = new Date().toISOString().slice(0, 10);

  // The daily game cap is consumed under a row lock, so two rounds resolving at
  // the same moment cannot both spend the last of the 100 XP budget.
  if (options.countsAsGameXp && xpAwarded > 0) {
    const consumed = await supabase.rpc("consume_game_xp", {
      p_user_id: userId,
      p_today: today,
      p_requested: xpAwarded,
    });
    if (consumed.error) throw consumed.error;
    xpAwarded = Number(consumed.data ?? 0);
  }

  const before = levelFromXp(current.xp).level;

  // XP and coins move through an atomic SQL increment. Writing absolute
  // values read from `current` lost one of two overlapping awards (e.g. a
  // game round resolving while a wheel spin lands), silently deleting XP.
  const applied = await supabase.rpc("apply_xp_coins", {
    p_user_id: userId,
    p_xp: xpAwarded,
    p_coins: coinsAwarded,
  });
  if (applied.error) throw applied.error;
  const appliedRow = Array.isArray(applied.data) ? applied.data[0] : applied.data;
  const newXp = Number(
    (appliedRow as { xp?: number } | null)?.xp ?? current.xp + xpAwarded,
  );
  const newCoins = Number(
    (appliedRow as { coins?: number } | null)?.coins ??
      Math.max(0, current.coins + coinsAwarded),
  );
  const after = levelFromXp(newXp).level;

  // The remaining row patch must not carry any field the RPCs above own:
  // xp, coins and the daily game-XP bookkeeping are stripped from the spread
  // so this write cannot undo an atomic increment.
  const {
    xp: _previousXp,
    coins: _previousCoins,
    game_xp_today: _previousGameXp,
    game_xp_day: _previousGameXpDay,
    ...currentWithoutBalance
  } = current;
  void _previousXp;
  void _previousCoins;
  void _previousGameXp;
  void _previousGameXpDay;

  const patch: Record<string, unknown> = {
    level: after,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("user_progress")
    .upsert(
      { ...currentWithoutBalance, ...patch },
      { onConflict: "user_id" },
    );
  if (error) throw error;

  if (options.feedTitle) {
    await logActivity({
      userId,
      kind: options.feedKind ?? "xp",
      title: options.feedTitle,
      body: options.feedBody ?? null,
      xpAmount: xpAwarded || null,
      coinsAmount: coinsAwarded || null,
      payload: options.payload ?? null,
    });
  }

  if (after > before) {
    await logActivity({
      userId,
      kind: "level_up",
      title: `reached level ${after}!`,
      body: `Level badge ${after}/100 unlocked.`,
      xpAmount: null,
      payload: { level: after },
    });
  }

  if (!options.skipAchievements) {
    await evaluateAchievements(userId).catch((error) =>
      console.warn("[xp] achievement evaluation failed:", error),
    );
  }

  return {
    xpAwarded,
    coinsAwarded,
    level: after,
    leveledUp: after > before,
    newLevel: after,
    coins: newCoins,
  };
}

/**
 * Atomic coin deltas. Never write an absolute balance computed from a read —
 * that silently discards any award that landed in between.
 */
export async function bumpCoins(userId: string, delta: number): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("add_coins", {
    p_user_id: userId,
    p_amount: Math.floor(delta),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function adjustCoins(
  userId: string,
  delta: number,
  extra: Partial<Record<string, unknown>> = {},
): Promise<number> {
  const supabase = createAdminClient();
  const newCoins = await bumpCoins(userId, delta);
  if (Object.keys(extra).length > 0) {
    const { error } = await supabase
      .from("user_progress")
      .update({ ...extra, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw error;
  }
  return newCoins;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
