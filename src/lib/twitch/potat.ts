import { envOrNull } from "@/lib/env";
import type {
  PotatBadgeDistribution,
  PotatBadgeOwners,
  PotatOwnedUser,
} from "./types";

const DEFAULT_API = "https://api.potat.app";

interface PotatDistributionPage {
  data: PotatBadgeDistribution[];
  pagination?: { cursor?: string; hasNextPage?: boolean };
}

interface PotatOwnersPage {
  data: PotatBadgeOwners[];
  pagination?: { cursor?: string; hasNextPage?: boolean };
}

interface PotatOwnedPage {
  data: PotatOwnedUser[];
  pagination?: { cursor?: string; hasNextPage?: boolean };
}

/**
 * potat.app rate limits with a Retry-After: 60 on overuse — honor it once,
 * then surface the failure instead of hammering the API.
 */
async function potatFetch(path: string, revalidate = 0): Promise<Response> {
  const base = envOrNull("POTAT_API_URL") ?? DEFAULT_API;
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "60");
    if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 65) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return fetch(url, {
        headers: { accept: "application/json" },
        next: { revalidate: 0 },
      });
    }
    throw new Error(`potat.app rate limited (Retry-After ${retryAfter}s)`);
  }
  if (!res.ok) {
    throw new Error(`potat.app ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res;
}

/** Currently-active user counts per badge version ("Users Active", %). */
export async function fetchDistributionPage(
  first = 200,
  after?: string,
): Promise<PotatDistributionPage> {
  const params = new URLSearchParams({ first: String(Math.min(first, 200)) });
  if (after) params.set("after", after);
  const res = await potatFetch(`/twitch/badges?${params}`);
  return (await res.json()) as PotatDistributionPage;
}

export async function fetchAllDistribution(): Promise<PotatBadgeDistribution[]> {
  const all: PotatBadgeDistribution[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const page = await fetchDistributionPage(200, cursor);
    all.push(...page.data);
    cursor = page.pagination?.hasNextPage
      ? page.pagination.cursor
      : undefined;
    if (!cursor) break;
  }
  return all;
}

/** Lifetime owner counts per badge version ("Owners"). */
export async function fetchAllOwners(): Promise<PotatBadgeOwners[]> {
  const all: PotatBadgeOwners[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const params = new URLSearchParams({
      owners: "true",
      first: "200",
    });
    if (cursor) params.set("after", cursor);
    const res = await potatFetch(`/twitch/badges?${params}`);
    const page = (await res.json()) as PotatOwnersPage;
    all.push(...page.data);
    cursor = page.pagination?.hasNextPage
      ? page.pagination.cursor
      : undefined;
    if (!cursor) break;
  }
  return all;
}

/** Worldwide leaderboard of collectors by owned badge count. */
export async function fetchOwnedLeaderboard(
  pages = 2,
): Promise<PotatOwnedUser[]> {
  const all: PotatOwnedUser[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < pages; i += 1) {
    const params = new URLSearchParams({
      owned: "true",
      first: "100",
    });
    if (cursor) params.set("after", cursor);
    const res = await potatFetch(`/twitch/badges?${params}`);
    const page = (await res.json()) as PotatOwnedPage;
    all.push(...page.data);
    cursor = page.pagination?.hasNextPage
      ? page.pagination.cursor
      : undefined;
    if (!cursor) break;
  }
  return all;
}

export interface BadgesBlogRankingEntry {
  twitch_id: string;
  login: string;
  display_name: string;
  profile_image: string | null;
  badge_count: number;
  rank_position: number;
}

/** badges.blog top-100 collector ranking (BadgesBR community). */
export async function fetchBadgesBlogRanking(
  revalidate = 21600,
): Promise<BadgesBlogRankingEntry[]> {
  const res = await fetch("https://www.badges.blog/api/ranking", {
    headers: { accept: "application/json" },
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`badges.blog ranking failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<Record<string, unknown>>;
  };
  return (json.data ?? []).map((row) => ({
    twitch_id: String(row.twitch_id ?? row.id ?? ""),
    login: String(row.login ?? ""),
    display_name: String(row.display_name ?? row.login ?? ""),
    profile_image: (row.profile_image as string | null) ?? null,
    badge_count: Number(row.badge_count ?? 0),
    rank_position: Number(row.rank_position ?? 0),
  }));
}

/** Normalized potat.app user profile (GET /users/{username}). */
export interface PotatUserProfile {
  potatId: number | null;
  username: string;
  displayName: string | null;
  level: number | null;
  potatoes: number | null;
  firstSeen: string | null;
  color: string | null;
  twitchId: string | null;
  connections: Array<{ platform: string; id: string }>;
}

/** Live per-badge stats (GET /twitch/badges?badge={name}). */
export interface PotatBadgeLive {
  userCount: number | null;
  percentage: number | null;
}

/**
 * Fetch a user's potat.app profile: level, potatoes, first-seen, account
 * color and cross-platform connections (7TV, BTTV, Twitch).
 */
export async function fetchPotatUser(
  login: string,
  revalidate = 3600,
): Promise<PotatUserProfile | null> {
  const clean = login.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(clean)) return null;
  const res = await fetch(`${envOrNull("POTAT_API_URL") ?? DEFAULT_API}/users/${clean}`, {
    headers: { accept: "application/json" },
    next: { revalidate },
  });
  if (!res.ok) return null; // 404 = unknown to potat — not an error

  const json = (await res.json()) as {
    data?: Array<{
      user?: {
        user_id?: number;
        username?: string;
        display?: string;
        level?: number;
        first_seen?: string;
        connections?: Array<{
          platform?: string;
          id?: string;
          meta?: { color?: string };
        }>;
      };
      potatoes?: { count?: number } | number | null;
    }>;
  };
  const entry = json.data?.[0];
  const user = entry?.user;
  if (!user) return null;

  const potatoes =
    typeof entry?.potatoes === "number"
      ? entry.potatoes
      : (entry?.potatoes?.count ?? null);

  const twitchConnection = user.connections?.find(
    (c) => c.platform === "TWITCH",
  );

  return {
    potatId: user.user_id ?? null,
    username: user.username ?? clean,
    displayName: user.display ?? null,
    level: user.level ?? null,
    potatoes,
    firstSeen: user.first_seen ?? null,
    color: twitchConnection?.meta?.color ?? null,
    twitchId: twitchConnection?.id ?? null,
    connections: (user.connections ?? [])
      .filter((c) => c.platform && c.id)
      .map((c) => ({ platform: String(c.platform), id: String(c.id) })),
  };
}

/** Live user_count/percentage for a single badge (set_id). */
export async function fetchBadgeLiveStats(
  badgeName: string,
  revalidate = 300,
): Promise<PotatBadgeLive | null> {
  const base = envOrNull("POTAT_API_URL") ?? DEFAULT_API;
  const res = await fetch(
    `${base}/twitch/badges?badge=${encodeURIComponent(badgeName)}`,
    { headers: { accept: "application/json" }, next: { revalidate } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: Array<{ user_count?: number; percentage?: number }>;
  };
  const row = json.data?.[0];
  if (!row) return null;
  return {
    userCount: row.user_count ?? null,
    percentage: row.percentage ?? null,
  };
}
