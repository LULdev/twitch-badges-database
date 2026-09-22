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

/**
 * Read a progress row without creating one. `getProgress` upserts a row on miss
 * — correct for the signed-in user, wrong for a profile someone is merely
 * viewing: it wrote through the service role on an anonymous GET, inflated the
 * public "players" KPI and dragged the average level toward 1.
 */
export async function readProgress(userId: string): Promise<ProgressRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("user_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProgressRow | null) ?? null;
}

export async function getProgress(userId: string): Promise<ProgressRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("user_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  // A transient read failure must NOT be mistaken for "no row yet". Returning
  // zeroed defaults makes every caller believe the account is empty — award()
  // then writes those zeros back and wipes the player's XP and coins.
  if (error) throw error;
  if (data) return data as ProgressRow;
  const inserted = await supabase
    .from("user_progress")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (inserted.error) throw inserted.error;
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

/**
 * Guarantees the `user_progress` row exists before a daily gate RPC runs.
 *
 * `claim_daily_gate` / `claim_wheel_gate` only UPDATE: with no row the update
 * matches 0 rows and they report "already claimed" (`-1` / `false`), so a user
 * whose first gamification action is the daily bonus or the wheel was denied
 * the reward and told they had already collected it. ON CONFLICT DO NOTHING is
 * idempotent, so this is safe on every path (and needs no new SQL).
 */
export async function ensureProgress(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_progress")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw error;
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

  const before = levelFromXp(current.xp).level;

  // XP and coins move through an atomic SQL increment. Writing absolute
  // values read from `current` lost one of two overlapping awards (e.g. a
  // game round resolving while a wheel spin lands), silently deleting XP.
  // Game XP takes the daily cap and the award through ONE statement: the budget
  // is clamped under the same row lock and the XP and coins move in the same
  // UPDATE, so a failure can no longer spend part of the day's budget without
  // granting anything. Everything else uses the plain increment.
  let newXp: number;
  let newCoins: number;
  if (options.countsAsGameXp && xpAwarded > 0) {
    const applied = await supabase.rpc("consume_and_apply_game_xp", {
      p_user_id: userId,
      p_today: today,
      p_requested: xpAwarded,
      p_coins: coinsAwarded,
    });
    if (applied.error) throw applied.error;
    const row = Array.isArray(applied.data) ? applied.data[0] : applied.data;
    const granted = Number((row as { granted?: number } | null)?.granted ?? 0);
    xpAwarded = granted;
    newXp = Number(
      (row as { out_xp?: number } | null)?.out_xp ?? current.xp + granted,
    );
    newCoins = Number(
      (row as { out_coins?: number } | null)?.out_coins ??
        Math.max(0, current.coins + coinsAwarded),
    );
  } else {
    const applied = await supabase.rpc("apply_xp_coins", {
      p_user_id: userId,
      p_xp: xpAwarded,
      p_coins: coinsAwarded,
    });
    if (applied.error) throw applied.error;
    const appliedRow = Array.isArray(applied.data)
      ? applied.data[0]
      : applied.data;
    newXp = Number(
      (appliedRow as { xp?: number } | null)?.xp ?? current.xp + xpAwarded,
    );
    newCoins = Number(
      (appliedRow as { coins?: number } | null)?.coins ??
        Math.max(0, current.coins + coinsAwarded),
    );
  }
  const after = levelFromXp(newXp).level;

  // The remaining row patch must not carry ANY column that an atomic RPC owns.
  // Migrations 0006/0007 move xp, coins, the daily game-XP bookkeeping, every
  // counter and every daily gate through SQL increments; writing the snapshot
  // back would undo an increment that landed between the read and this write
  // (a cross-request race, e.g. a game settlement while a wheel spin resolves).
  // What is left for award() to own is the derived level.
  const {
    xp: _xp,
    coins: _coins,
    game_xp_today: _gameXpToday,
    game_xp_day: _gameXpDay,
    games_played: _gamesPlayed,
    games_won: _gamesWon,
    coins_won: _coinsWon,
    coins_lost: _coinsLost,
    wheel_spins: _wheelSpins,
    steals_successful: _stealsOk,
    steals_failed: _stealsFailed,
    times_robbed: _robbed,
    achievements_points: _achPoints,
    login_streak: _streak,
    best_login_streak: _bestStreak,
    last_login_date: _lastLogin,
    last_wheel_date: _lastWheel,
    ...rest
  } = current;
  void _xp;
  void _coins;
  void _gameXpToday;
  void _gameXpDay;
  void _gamesPlayed;
  void _gamesWon;
  void _coinsWon;
  void _coinsLost;
  void _wheelSpins;
  void _stealsOk;
  void _stealsFailed;
  void _robbed;
  void _achPoints;
  void _streak;
  void _bestStreak;
  void _lastLogin;
  void _lastWheel;

  const patch: Record<string, unknown> = {
    ...rest,
    level: after,
    updated_at: new Date().toISOString(),
  };

  // Update, not upsert: the row is guaranteed to exist because getProgress()
  // above either read it or inserted it, and an upsert would re-write every
  // column that arrived in the payload.
  //
  // `level` is the ONLY column award() still owns, and it is derived purely from
  // the xp apply_xp_coins already committed. A failure here therefore must not
  // throw: the caller (a game round, a wheel spin) has already moved XP and
  // coins, and reporting a 500 made the client retry and play a second round.
  // The worst case is a cached level that lags until the next award recomputes
  // it — which is exactly what a stale `level` was before.
  const { error } = await supabase
    .from("user_progress")
    .update(patch)
    .eq("user_id", userId);
  if (error) console.warn("[xp] derived level write failed:", error);

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
