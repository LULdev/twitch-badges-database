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

  if (options.countsAsGameXp && xpAwarded > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const spentToday =
      current.game_xp_day === today ? current.game_xp_today : 0;
    const cap = Math.max(0, 100 - spentToday);
    xpAwarded = Math.min(xpAwarded, cap);
  }

  const newXp = current.xp + xpAwarded;
  const newCoins = Math.max(0, current.coins + coinsAwarded);
  const before = levelFromXp(current.xp).level;
  const after = levelFromXp(newXp).level;
  const today = new Date().toISOString().slice(0, 10);

  const patch: Record<string, unknown> = {
    xp: newXp,
    coins: newCoins,
    level: after,
    updated_at: new Date().toISOString(),
  };
  if (options.countsAsGameXp && xpAwarded > 0) {
    patch.game_xp_day = today;
    patch.game_xp_today =
      (current.game_xp_day === today ? current.game_xp_today : 0) + xpAwarded;
  }

  const { error } = await supabase
    .from("user_progress")
    .upsert(
      { ...current, ...patch },
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

export async function adjustCoins(
  userId: string,
  delta: number,
  extra: Partial<Record<string, unknown>> = {},
): Promise<number> {
  const supabase = createAdminClient();
  const current = await getProgress(userId);
  const newCoins = Math.max(0, current.coins + Math.floor(delta));
  const { error } = await supabase
    .from("user_progress")
    .update({ coins: newCoins, ...extra, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
  return newCoins;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
