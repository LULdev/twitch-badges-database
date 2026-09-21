import { createClient } from "./supabase/server";

/**
 * Aggregated reads for /stats. Everything here comes from pre-computed
 * Postgres views (migration 0004) so the page never scans raw tables in JS.
 * Every call is individually guarded: a missing view (un-migrated DB) must
 * render an empty state, never crash the page.
 */

export type ServiceStatus = "operational" | "degraded" | "down";

export interface GamificationStats {
  players: number;
  totalXp: number;
  totalCoins: number;
  coinsWon: number;
  coinsLost: number;
  gamesPlayed: number;
  gamesWon: number;
  wheelSpins: number;
  stealsSuccessful: number;
  stealsFailed: number;
  timesRobbed: number;
  achievementPoints: number;
  avgLevel: number;
  maxLevel: number;
  active1d: number;
  active7d: number;
  active30d: number;
  lastActivity: string | null;
}

export interface LevelRow {
  level: number;
  players: number;
  xp: number;
  coins: number;
}

export interface TopPlayer {
  username: string;
  avatar_url: string | null;
  xp: number;
  coins: number;
  level: number;
  games_played: number;
  games_won: number;
  achievements_points: number;
}

export interface GameStat {
  game: string;
  rounds: number;
  wins: number;
  wagered: number;
  paid_out: number;
  biggest_win: number;
  biggest_bet: number;
  players: number;
  last_played: string | null;
}

export interface BiggestWin {
  id: number;
  game: string;
  bet: number;
  payout: number;
  created_at: string;
  username: string;
  avatar_url: string | null;
}

export interface DailyXpRow {
  day: string;
  events: number;
  xp: number;
  coins: number;
  players: number;
}

export interface ActivityKindRow {
  kind: string;
  events: number;
  events_24h: number;
  xp: number;
  coins: number;
}

export interface AchievementStat {
  achievement_id: string;
  category: "common" | "creative" | "special" | "other";
  unlocks: number;
  players: number;
  first_unlock: string | null;
  last_unlock: string | null;
}

export interface StealStats {
  attempts: number;
  successes: number;
  cost_paid: number;
  coins_stolen: number;
  biggest_steal: number;
  thieves: number;
  victims: number;
}

export interface WheelStats {
  spins: number;
  spins_today: number;
  turbo_wins: number;
  turbo_delivered: number;
}

export interface ClaimStats {
  claims: number;
  claimers: number;
  claim_xp: number;
  daily_claims: number;
  coin_rains: number;
}

export interface TrafficStats {
  blog_posts: number;
  blog_published: number;
  blog_views: number;
  blog_views_7d: number;
  blog_reactions: number;
  profile_visits: number;
  profile_visits_7d: number;
  profile_views_total: number;
}

export interface SystemStats {
  badges: number;
  badge_stat_rows: number;
  badge_events: number;
  profiles: number;
  inventory_rows: number;
  blog_posts: number;
  changelog_entries: number;
  notifications: number;
  push_subscriptions: number;
  activity_events: number;
  game_rounds: number;
  steal_attempts: number;
  achievement_unlocks: number;
  heartbeats: number;
  badges_last_seen: string | null;
  badges_last_polled: string | null;
  last_activity: string | null;
  last_change: string | null;
  last_post: string | null;
}

export interface DailyCountRow {
  day: string;
  count: number;
}

export interface UptimeSource {
  source: string;
  checks_total: number;
  ok_total: number;
  error_total: number;
  checks_24h: number;
  ok_24h: number;
  checks_7d: number;
  ok_7d: number;
  checks_30d: number;
  ok_30d: number;
  avg_ms_24h: number | null;
  max_ms: number | null;
  last_status: string | null;
  last_message: string | null;
  last_ms: number | null;
  last_at: string | null;
  first_at: string | null;
}

export interface UptimeDailyRow {
  day: string;
  source: string;
  checks: number;
  ok: number;
  errors: number;
  avg_ms: number | null;
}

export interface UptimeHourlyRow {
  hour: string;
  checks: number;
  ok: number;
}

export interface PlatformStats {
  gamification: GamificationStats | null;
  levels: LevelRow[];
  topPlayers: TopPlayer[];
  games: GameStat[];
  biggestWins: BiggestWin[];
  dailyXp: DailyXpRow[];
  activityKinds: ActivityKindRow[];
  achievements: AchievementStat[];
  steals: StealStats | null;
  wheel: WheelStats | null;
  claims: ClaimStats | null;
  traffic: TrafficStats | null;
  system: SystemStats | null;
  dailyUsers: DailyCountRow[];
  dailyBadges: DailyCountRow[];
  uptime: {
    sources: UptimeSource[];
    daily: UptimeDailyRow[];
    hourly: UptimeHourlyRow[];
    availability24h: number | null;
    availability7d: number | null;
    availability30d: number | null;
    availabilityAll: number | null;
    lastHeartbeat: string | null;
    status: ServiceStatus;
  };
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick<T>(value: T | null | undefined, fallback: T): T {
  return value === null || value === undefined ? fallback : value;
}

/** Percent of successful checks, or null when there is no data yet. */
export function availability(ok: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, (ok / total) * 100));
}

function serviceStatus(sources: UptimeSource[]): ServiceStatus {
  if (sources.length === 0) return "degraded";
  const latest = sources
    .map((source) => source.last_at ?? "")
    .sort()
    .at(-1);
  if (!latest) return "degraded";
  const ageMinutes = (Date.now() - new Date(latest).getTime()) / 60_000;
  const errored = sources.filter((source) => source.last_status === "error");
  // No heartbeat in 36h means the pipeline is not running at all.
  if (ageMinutes > 60 * 36) return "down";
  if (errored.length > 0 || ageMinutes > 120) return "degraded";
  return "operational";
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const supabase = await createClient();

  const safe = async <T>(
    run: () => PromiseLike<{ data: unknown }>,
    fallback: T,
  ): Promise<T> => {
    try {
      const { data } = await run();
      return pick(data as T, fallback);
    } catch {
      return fallback;
    }
  };

  const [
    gamification,
    levels,
    topPlayers,
    games,
    biggestWins,
    dailyXp,
    activityKinds,
    achievements,
    steals,
    wheel,
    claims,
    traffic,
    system,
    dailyUsers,
    dailyBadges,
    uptimeSources,
    uptimeDaily,
    uptimeHourly,
  ] = await Promise.all([
    safe(
      () => supabase.from("stats_gamification").select("*").maybeSingle(),
      null,
    ),
    safe(() => supabase.from("stats_levels").select("*"), []),
    safe(() => supabase.from("stats_top_players").select("*"), []),
    safe(() => supabase.from("stats_games").select("*"), []),
    safe(() => supabase.from("stats_biggest_wins").select("*"), []),
    safe(() => supabase.from("stats_daily_xp").select("*"), []),
    safe(() => supabase.from("stats_activity_kinds").select("*"), []),
    safe(() => supabase.from("stats_achievements").select("*"), []),
    safe(() => supabase.from("stats_steals").select("*").maybeSingle(), null),
    safe(() => supabase.from("stats_wheel").select("*").maybeSingle(), null),
    safe(() => supabase.from("stats_badge_claims").select("*").maybeSingle(), null),
    safe(() => supabase.from("stats_traffic").select("*").maybeSingle(), null),
    safe(() => supabase.from("stats_system").select("*").maybeSingle(), null),
    safe(() => supabase.from("stats_daily_users").select("*"), []),
    safe(() => supabase.from("stats_daily_badges").select("*"), []),
    safe(() => supabase.from("stats_uptime_sources").select("*"), []),
    safe(() => supabase.from("stats_uptime_daily").select("*"), []),
    safe(() => supabase.from("stats_uptime_hourly").select("*"), []),
  ]);

  const sources = (uptimeSources as UptimeSource[]).map((row) => ({
    ...row,
    checks_total: num(row.checks_total),
    ok_total: num(row.ok_total),
    error_total: num(row.error_total),
    checks_24h: num(row.checks_24h),
    ok_24h: num(row.ok_24h),
    checks_7d: num(row.checks_7d),
    ok_7d: num(row.ok_7d),
    checks_30d: num(row.checks_30d),
    ok_30d: num(row.ok_30d),
    avg_ms_24h: row.avg_ms_24h === null ? null : num(row.avg_ms_24h),
    max_ms: row.max_ms === null ? null : num(row.max_ms),
    last_ms: row.last_ms === null ? null : num(row.last_ms),
  }));

  const sum = (key: "checks_total" | "ok_total" | "checks_24h" | "ok_24h" | "checks_7d" | "ok_7d" | "checks_30d" | "ok_30d") =>
    sources.reduce((total, source) => total + num(source[key]), 0);

  const lastHeartbeat =
    sources
      .map((source) => source.last_at ?? "")
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  const rawGamification = gamification as GamificationStats | null;

  return {
    gamification: rawGamification
      ? {
          ...rawGamification,
          players: num(rawGamification.players),
          totalXp: num(rawGamification.totalXp),
          totalCoins: num(rawGamification.totalCoins),
          coinsWon: num(rawGamification.coinsWon),
          coinsLost: num(rawGamification.coinsLost),
          gamesPlayed: num(rawGamification.gamesPlayed),
          gamesWon: num(rawGamification.gamesWon),
          wheelSpins: num(rawGamification.wheelSpins),
          stealsSuccessful: num(rawGamification.stealsSuccessful),
          stealsFailed: num(rawGamification.stealsFailed),
          timesRobbed: num(rawGamification.timesRobbed),
          achievementPoints: num(rawGamification.achievementPoints),
          avgLevel: num(rawGamification.avgLevel),
          maxLevel: num(rawGamification.maxLevel),
          active1d: num(rawGamification.active1d),
          active7d: num(rawGamification.active7d),
          active30d: num(rawGamification.active30d),
        }
      : null,
    levels: (levels as LevelRow[]).map((row) => ({
      level: num(row.level),
      players: num(row.players),
      xp: num(row.xp),
      coins: num(row.coins),
    })),
    topPlayers: (topPlayers as TopPlayer[]).map((row) => ({
      ...row,
      xp: num(row.xp),
      coins: num(row.coins),
      level: num(row.level),
      games_played: num(row.games_played),
      games_won: num(row.games_won),
      achievements_points: num(row.achievements_points),
    })),
    games: (games as GameStat[]).map((row) => ({
      ...row,
      rounds: num(row.rounds),
      wins: num(row.wins),
      wagered: num(row.wagered),
      paid_out: num(row.paid_out),
      biggest_win: num(row.biggest_win),
      biggest_bet: num(row.biggest_bet),
      players: num(row.players),
    })),
    biggestWins: (biggestWins as BiggestWin[]).map((row) => ({
      ...row,
      bet: num(row.bet),
      payout: num(row.payout),
    })),
    dailyXp: (dailyXp as DailyXpRow[]).map((row) => ({
      day: String(row.day),
      events: num(row.events),
      xp: num(row.xp),
      coins: num(row.coins),
      players: num(row.players),
    })),
    activityKinds: (activityKinds as ActivityKindRow[]).map((row) => ({
      kind: String(row.kind),
      events: num(row.events),
      events_24h: num(row.events_24h),
      xp: num(row.xp),
      coins: num(row.coins),
    })),
    achievements: (achievements as AchievementStat[]).map((row) => ({
      ...row,
      unlocks: num(row.unlocks),
      players: num(row.players),
    })),
    steals: steals ? (steals as StealStats) : null,
    wheel: wheel ? (wheel as WheelStats) : null,
    claims: claims ? (claims as ClaimStats) : null,
    traffic: traffic ? (traffic as TrafficStats) : null,
    system: system ? (system as SystemStats) : null,
    dailyUsers: (dailyUsers as DailyCountRow[]).map((row) => ({
      day: String(row.day),
      count: num(row.count),
    })),
    dailyBadges: (dailyBadges as DailyCountRow[]).map((row) => ({
      day: String(row.day),
      count: num(row.count),
    })),
    uptime: {
      sources,
      daily: (uptimeDaily as UptimeDailyRow[]).map((row) => ({
        day: String(row.day),
        source: String(row.source),
        checks: num(row.checks),
        ok: num(row.ok),
        errors: num(row.errors),
        avg_ms: row.avg_ms === null ? null : num(row.avg_ms),
      })),
      hourly: (uptimeHourly as UptimeHourlyRow[]).map((row) => ({
        hour: String(row.hour),
        checks: num(row.checks),
        ok: num(row.ok),
      })),
      availability24h: availability(sum("ok_24h"), sum("checks_24h")),
      availability7d: availability(sum("ok_7d"), sum("checks_7d")),
      availability30d: availability(sum("ok_30d"), sum("checks_30d")),
      availabilityAll: availability(sum("ok_total"), sum("checks_total")),
      lastHeartbeat,
      status: serviceStatus(sources),
    },
  };
}

/** Continuous day series for charts (missing days become zeros). */
export function daySeries<T>(
  rows: Array<{ day: string } & T>,
  days = 30,
): Array<{ day: string; label: string } & Partial<T>> {
  const byDay = new Map<string, T>();
  for (const row of rows) byDay.set(String(row.day).slice(0, 10), row);

  const out: Array<{ day: string; label: string } & Partial<T>> = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - index);
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    out.push({
      day: key,
      label: `${date.getUTCDate()}.${date.getUTCMonth() + 1}.`,
      ...(row ? ({ ...row } as T) : ({} as T)),
    });
  }
  return out;
}
