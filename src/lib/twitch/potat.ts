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
