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
  /** Daily game-activity streak (0047) — owned by game_streak_gate. */
  game_streak: number;
  best_game_streak: number;
  game_streak_last: string | null;
  /** Exactly-once starter-item grant (0049) — owned by grant_starter_items. */
  starter_freezes_granted: boolean;
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
  | "first_login"
  | "streak_freeze"
  | "big_win"
  | "item_purchase"
  | "admin_adjust";

/* ------------------------------------------------------------------------- *
 * Short-TTL caches for the two reads that every wheel spin and every game
 * round repeats and that nothing on those paths needs to be byte-exact.
 *
 * These are round-trip savers, not a correctness mechanism: the economy already
 * treats the RPC return value as the authority for the balance, so a cache hit
 * costs nothing and a miss behaves exactly as it did before.
 * ------------------------------------------------------------------------- */

interface CacheEntry<T> {
  value: T;
  at: number;
}

const progressCache = new Map<string, CacheEntry<ProgressRow>>();
const feedIdentityCache = new Map<string, CacheEntry<FeedIdentity>>();

/**
 * How long a `user_progress` snapshot may back award()'s pre-read.
 *
 * The redundancy this removes is within ONE request: a game round reads the row
 * for the bet authorisation, `bumpCoins` moves the balance, and award() read
 * the row a second time. That whole chain is sub-second, so 2 s is generous
 * headroom while still bounding the one real exposure — a concurrent award on a
 * second request for the same user — to roughly the duration of the request it
 * is racing.
 *
 * It is deliberately NOT applied to `getProgress` itself: `/api/progress` and
 * the "not enough coins" authorisation in games.ts must keep reading fresh, and
 * a cache inside `getProgress` would silently make the debit check stale.
 */
const AWARD_PROGRESS_TTL_MS = 2_000;

/**
 * How long a profile's denormalized feed identity may be reused.
 *
 * `username` / `avatar_url` are copied onto `activity_events` as a point-in-time
 * record of who the player was when the event fired, so a rename surfacing up
 * to 30 s late changes nothing a reader can observe. One spin is otherwise
 * wasteful here: award() calls logActivity up to twice and every unlocked
 * achievement calls it again, each repeating the identical `profiles` SELECT.
 */
const FEED_IDENTITY_TTL_MS = 30_000;

/** Keeps a warm lambda from growing either map without bound. */
const CACHE_MAX_ENTRIES = 5_000;

function cacheGet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttl: number,
): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  // Map iterates in insertion order, so the first key is the oldest write.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, at: Date.now() });
}

interface FeedIdentity {
  username: string | null;
  avatar: string | null;
}

/**
 * The username/avatar that `logActivity` denormalizes onto every feed row.
 *
 * The error is swallowed exactly as before: a failed SELECT has always written
 * nulls onto the event, and turning that into a throw would drop feed rows that
 * are written today.
 */
async function getFeedIdentity(userId: string): Promise<FeedIdentity> {
  const cached = cacheGet(feedIdentityCache, userId, FEED_IDENTITY_TTL_MS);
  if (cached !== undefined) return cached;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  const identity: FeedIdentity = {
    username: data?.username ?? null,
    avatar: data?.avatar_url ?? null,
  };
  // A failed read must not be cached. Pre-cache, a transient pooler blip
  // nulled the identity of only the events written during the blip; caching
  // the nulls would pin them onto every feed row for the next 30 s. Leaving
  // the cache cold makes the next event retry, exactly as before.
  if (!error) cacheSet(feedIdentityCache, userId, identity);
  return identity;
}

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
      const identity = await getFeedIdentity(entry.userId);
      username = identity.username;
      avatar = identity.avatar;
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
    game_streak: 0,
    best_game_streak: 0,
    game_streak_last: null,
  }) as ProgressRow;
}

/**
 * award()'s pre-read: the same row and the same upsert-on-miss guarantee as
 * `getProgress`, but a warm cache answers it.
 *
 * The cached object is frozen because it is shared: award() is the only caller
 * and only reads it, but a future writer would otherwise poison every later
 * reader within the TTL. Errors are deliberately not cached and concurrent
 * misses are not de-duplicated — a miss behaves exactly as it does today, so a
 * transient read failure still throws rather than becoming a cached zeroed row.
 */
async function getProgressForAward(userId: string): Promise<ProgressRow> {
  const cached = cacheGet(progressCache, userId, AWARD_PROGRESS_TTL_MS);
  if (cached !== undefined) return cached;
  const row = await getProgress(userId);
  cacheSet(progressCache, userId, Object.freeze(row));
  return row;
}

/**
 * Write-through: republish what the atomic RPC actually committed so the next
 * read in the same burst sees the new balance rather than the snapshot taken
 * before this award.
 *
 * Merged, never replaced. Only xp and coins are republished because they are
 * the only columns this function knows post-RPC; the counters the migrations
 * moved into SQL are deliberately absent from the destructure in award() and
 * must not be fabricated here. A cold cache is left cold — a partial row would
 * be worse than a miss.
 */
function noteAwardedProgress(userId: string, xp: number, coins: number): void {
  const entry = progressCache.get(userId);
  if (!entry) return;
  cacheSet(progressCache, userId, Object.freeze({ ...entry.value, xp, coins }));
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
/**
 * Grant the 2 starter Streak Freezes exactly once (0049). The RPC's
 * compare-and-set predicate IS the guarantee — of two concurrent callers
 * exactly one UPDATE matches — so this may run on every authenticated
 * touchpoint. Best-effort: a failed grant must never block the caller.
 */
export async function ensureStarterItems(userId: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.rpc("grant_starter_items", { p_user_id: userId });
  } catch (error) {
    console.warn("[xp] starter item grant failed:", error);
  }
}

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
  // Same row, same upsert-on-miss guarantee, usually a cache hit. A game round
  // already read this row for the bet check and then bumped the coins, so this
  // was the third read of one request. Of the whole row only `xp` (for
  // `before`) and the never-reached `coins` fallback are consumed — everything
  // else is destructured away below.
  const current = await getProgressForAward(userId);

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
  noteAwardedProgress(userId, newXp, newCoins);
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
    game_streak: _gameStreak,
    best_game_streak: _bestGameStreak,
    game_streak_last: _gameStreakLast,
    // 0049's grant_starter_items owns this column compare-and-set. getProgress
    // reads it via select("*"), and without the exclusion every award would
    // write the stale pre-grant false back over the RPC's true — re-arming the
    // exactly-once predicate and minting another +2 Streak Freezes per round.
    starter_freezes_granted: _starterFreezes,
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
  void _gameStreak;
  void _bestGameStreak;
  void _gameStreakLast;
  void _starterFreezes;

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
