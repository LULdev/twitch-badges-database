import { createClient } from "./supabase/server";

export interface BadgeRow {
  id: string;
  set_id: string;
  version: string;
  slug: string;
  title: string;
  description: string | null;
  image_url_1x: string | null;
  image_url_2x: string | null;
  image_url_4x: string | null;
  click_url: string | null;
  category: string;
  is_paid: boolean;
  how_to_earn: string | null;
  start_date: string | null;
  end_date: string | null;
  release_date: string | null;
  status: "active" | "upcoming" | "expired" | "removed";
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
  source: string;
  owner_count: number | null;
  active_count: number | null;
  percentage: number | null;
  last_polled_at: string | null;
  rarity_score: number;
  rarity_tier:
    | "common"
    | "uncommon"
    | "rare"
    | "epic"
    | "legendary"
    | "mythic";
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  twitch_id: string | null;
  avatar_url: string | null;
  bio: string | null;
  color: string | null;
  banner_url: string | null;
  theme: string;
  showcase_slots: string[];
  inventory_public: boolean;
  is_admin: boolean;
  twitch_created_at: string | null;
  potat_level: number | null;
  potatoes: number | null;
  potat_first_seen: string | null;
  potat_connections: Array<{ platform: string; id: string }> | null;
  customization: Record<string, unknown> | null;
  view_count: number | null;
  mood: string | null;
  steal_enabled: boolean | null;
  steal_price: number | null;
  steal_max: number | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_url: string | null;
  author: string;
  status: "draft" | "published";
  is_auto: boolean;
  locale: string;
  tags: string[];
  published_at: string;
  created_at: string;
  updated_at: string;
}

export interface ChangelogRow {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  url: string | null;
  created_at: string;
}

export interface CollectorStatsRow {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  inventory_public: boolean;
  badges_owned: number;
  last_acquired_at: string | null;
}

export type SortKey =
  | "newest"
  | "oldest"
  | "rarity"
  | "owners"
  | "ending"
  | "releasing"
  | "name";

export interface ListFilters {
  q?: string;
  status?: string;
  price?: string;
  category?: string;
  rarity?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

function sanitizeQuery(q: string): string {
  // Strip characters that break PostgREST's .or(...) syntax.
  return q.replace(/[,()%]/g, " ").trim();
}

export async function listBadges(
  filters: ListFilters,
): Promise<ListResult<BadgeRow>> {
  const supabase = await createClient();
  const perPage = Math.min(Math.max(filters.perPage ?? 48, 12), 96);
  const page = Math.max(filters.page ?? 1, 1);

  let query = supabase
    .from("badges")
    .select("*", { count: "exact", head: false });

  const q = filters.q ? sanitizeQuery(filters.q) : "";
  if (q) {
    query = query.or(
      `title.ilike.%${q}%,set_id.ilike.%${q}%,slug.ilike.%${q}%`,
    );
  }
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.price === "free") query = query.eq("is_paid", false);
  if (filters.price === "paid") query = query.eq("is_paid", true);
  if (filters.category && filters.category !== "all") {
    query = query.eq("category", filters.category);
  }
  if (filters.rarity && filters.rarity !== "all") {
    query = query.eq("rarity_tier", filters.rarity);
  }

  const sort: SortKey = (filters.sort as SortKey) ?? "newest";
  switch (sort) {
    case "oldest":
      query = query.order("first_seen_at", { ascending: true });
      break;
    case "rarity":
      query = query.order("rarity_score", { ascending: false });
      break;
    case "owners":
      query = query.order("owner_count", {
        ascending: false,
        nullsFirst: false,
      });
      break;
    case "ending":
      query = query
        .not("end_date", "is", null)
        .order("end_date", { ascending: true, nullsFirst: false });
      break;
    case "releasing":
      query = query
        .not("start_date", "is", null)
        .order("start_date", { ascending: true, nullsFirst: false });
      break;
    case "name":
      query = query.order("title", { ascending: true });
      break;
    default:
      query = query.order("first_seen_at", { ascending: false });
  }

  query = query.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const total = count ?? 0;
  return {
    items: (data ?? []) as BadgeRow[],
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getBadgeBySlug(slug: string): Promise<BadgeRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badges")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as BadgeRow | null) ?? null;
}

export interface StatsPoint {
  polled_at: string;
  owner_count: number | null;
  active_count: number | null;
}

export async function getBadgeStatsHistory(
  badgeId: string,
  limit = 250,
): Promise<StatsPoint[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badge_stats")
    .select("polled_at, owner_count, active_count")
    .eq("badge_id", badgeId)
    .order("polled_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as StatsPoint[];
}

export interface HomeData {
  endingSoon: BadgeRow[];
  upcoming: BadgeRow[];
  newest: BadgeRow[];
  rarest: BadgeRow[];
  counts: { active: number; upcoming: number; expired: number; total: number };
  latestChangelog: ChangelogRow[];
  latestPosts: BlogPostRow[];
}

export async function getHomeData(): Promise<HomeData> {
  const supabase = await createClient();

  const [
    endingSoonRes,
    upcomingRes,
    newestRes,
    rarestRes,
    activeCountRes,
    upcomingCountRes,
    expiredCountRes,
    totalCountRes,
    changelogRes,
    postsRes,
  ] = await Promise.all([
    supabase
      .from("badges")
      .select("*")
      .eq("status", "active")
      .not("end_date", "is", null)
      .order("end_date", { ascending: true })
      .limit(6),
    supabase
      .from("badges")
      .select("*")
      .eq("status", "upcoming")
      .order("start_date", { ascending: true, nullsFirst: false })
      .limit(6),
    supabase
      .from("badges")
      .select("*")
      .order("first_seen_at", { ascending: false })
      .limit(8),
    supabase
      .from("badges")
      .select("*")
      .order("rarity_score", { ascending: false })
      .limit(6),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("status", "upcoming"),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("status", "expired"),
    supabase.from("badges").select("id", { count: "exact", head: true }),
    supabase
      .from("changelog")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("blog_posts")
      .select("*")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(3),
  ]);

  return {
    endingSoon: (endingSoonRes.data ?? []) as BadgeRow[],
    upcoming: (upcomingRes.data ?? []) as BadgeRow[],
    newest: (newestRes.data ?? []) as BadgeRow[],
    rarest: (rarestRes.data ?? []) as BadgeRow[],
    counts: {
      active: activeCountRes.count ?? 0,
      upcoming: upcomingCountRes.count ?? 0,
      expired: expiredCountRes.count ?? 0,
      total: totalCountRes.count ?? 0,
    },
    latestChangelog: (changelogRes.data ?? []) as ChangelogRow[],
    latestPosts: (postsRes.data ?? []) as BlogPostRow[],
  };
}

export async function getCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badges")
    .select("category")
    .order("category");
  const set = new Set((data ?? []).map((row) => row.category as string));
  return [...set].sort();
}

export async function getProfileByUsername(
  username: string,
): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

export interface InventoryItem {
  acquired_at: string;
  badge: BadgeRow | null;
}

export async function getInventory(
  userId: string,
): Promise<InventoryItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_inventory")
    .select("acquired_at, badges(*)")
    .eq("user_id", userId);
  return ((data ?? []) as unknown as Array<{
    acquired_at: string;
    badges: BadgeRow | null;
  }>).map((row) => ({
    acquired_at: row.acquired_at,
    badge: row.badges,
  }));
}

export async function getSiteLeaderboard(
  limit = 50,
): Promise<CollectorStatsRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("collector_stats")
    .select("*")
    .eq("inventory_public", true)
    .order("badges_owned", { ascending: false })
    .limit(limit);
  return (data ?? []) as CollectorStatsRow[];
}

export async function listPosts(publishedOnly = true): Promise<BlogPostRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("blog_posts")
    .select("*")
    .order("published_at", { ascending: false });
  if (publishedOnly) query = query.eq("status", "published");
  const { data } = await query;
  return (data ?? []) as BlogPostRow[];
}

export async function getPostBySlug(slug: string): Promise<BlogPostRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as BlogPostRow | null) ?? null;
}

export async function listChangelog(
  kind?: string,
  limit = 100,
): Promise<ChangelogRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("changelog")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (kind && kind !== "all") query = query.eq("kind", kind);
  const { data } = await query;
  return (data ?? []) as ChangelogRow[];
}

export async function listNotifications(
  limit = 30,
): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationRow[];
}

/** Minimal catalog projection used to match perfil badge lists. */
export interface CatalogKeyRow {
  id: string;
  slug: string;
  set_id: string;
  version: string;
  title: string;
  image_url_2x: string | null;
  category: string;
  is_paid: boolean;
  rarity_tier: BadgeRow["rarity_tier"];
  rarity_score: number;
  status: BadgeRow["status"];
  end_date: string | null;
}

export async function getCatalogKeys(): Promise<CatalogKeyRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badges")
    .select(
      "id,slug,set_id,version,title,image_url_2x,category,is_paid,rarity_tier,rarity_score,status,end_date",
    )
    .neq("status", "removed")
    .order("rarity_score", { ascending: false })
    .limit(3000);
  return (data ?? []) as CatalogKeyRow[];
}

export interface SiteStats {
  totalBadges: number;
  active: number;
  upcoming: number;
  expired: number;
  free: number;
  paid: number;
  rarityDistribution: Record<string, number>;
  categoryCounts: Array<{ category: string; count: number }>;
  totalTrackedUsers: number | null;
  newestBadges: BadgeRow[];
}

export async function getSiteStats(): Promise<SiteStats> {
  const supabase = await createClient();
  const [
    totalRes,
    activeRes,
    upcomingRes,
    expiredRes,
    freeRes,
    paidRes,
    rarityRes,
    categoryRes,
    newestRes,
  ] = await Promise.all([
    supabase.from("badges").select("id", { count: "exact", head: true }),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("status", "upcoming"),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("status", "expired"),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("is_paid", false),
    supabase
      .from("badges")
      .select("id", { count: "exact", head: true })
      .eq("is_paid", true),
    supabase
      .from("badges")
      .select("rarity_tier")
      .not("rarity_tier", "is", null),
    supabase.from("badges").select("category"),
    supabase
      .from("badges")
      .select("*")
      .order("first_seen_at", { ascending: false })
      .limit(12),
  ]);

  const rarityDistribution: Record<string, number> = {};
  for (const row of (rarityRes.data ?? []) as Array<{ rarity_tier: string }>) {
    rarityDistribution[row.rarity_tier] =
      (rarityDistribution[row.rarity_tier] ?? 0) + 1;
  }

  const categoryMap = new Map<string, number>();
  for (const row of (categoryRes.data ?? []) as Array<{ category: string }>) {
    categoryMap.set(
      row.category,
      (categoryMap.get(row.category) ?? 0) + 1,
    );
  }

  return {
    totalBadges: totalRes.count ?? 0,
    active: activeRes.count ?? 0,
    upcoming: upcomingRes.count ?? 0,
    expired: expiredRes.count ?? 0,
    free: freeRes.count ?? 0,
    paid: paidRes.count ?? 0,
    rarityDistribution,
    categoryCounts: [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    totalTrackedUsers: null,
    newestBadges: (newestRes.data ?? []) as BadgeRow[],
  };
}

export async function getRarestBadges(limit = 10): Promise<BadgeRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badges")
    .select("*")
    .order("rarity_score", { ascending: false })
    .limit(limit);
  return (data ?? []) as BadgeRow[];
}

export async function getMostOwnedBadges(limit = 10): Promise<BadgeRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badges")
    .select("*")
    .not("owner_count", "is", null)
    .order("owner_count", { ascending: false })
    .limit(limit);
  return (data ?? []) as BadgeRow[];
}
