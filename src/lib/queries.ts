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
  /** Staff level: 'user' | 'moderator' | 'admin' | 'owner'. */
  role: string;
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

export const SORT_KEYS = [
  "newest",
  "oldest",
  "rarity",
  "owners",
  "ending",
  "releasing",
  "name",
] as const satisfies readonly SortKey[];

/**
 * The single place a `?sort=` is resolved to an applied key. `listBadges` and the
 * FilterBar control both come through here, so an unknown or empty `?sort=` can no
 * longer make the displayed sort and the applied sort disagree — the control used
 * to fall back to the page's own default (e.g. "ending" on /active) while the
 * query fell back to "newest".
 */
export function resolveSortKey(value: unknown, fallback?: string): SortKey {
  const single = Array.isArray(value) ? value[0] : value;
  if (typeof single === "string" && (SORT_KEYS as readonly string[]).includes(single)) {
    return single as SortKey;
  }
  if (typeof fallback === "string" && (SORT_KEYS as readonly string[]).includes(fallback)) {
    return fallback as SortKey;
  }
  return "newest";
}

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
  // Strip characters that break PostgREST's .or(...) syntax. `*` is included
  // because PostgREST aliases it to `%` in ilike.
  return q.replace(/[,()%*]/g, " ").trim();
}

export async function listBadges(
  filters: ListFilters,
): Promise<ListResult<BadgeRow>> {
  const supabase = await createClient();
  const perPage = Math.min(Math.max(filters.perPage ?? 48, 12), 96);
  // Floored at the entry: a fractional ?page= (2.3) reached range() as a
  // non-integer offset — a 400, or a silently shifted window for 2.5.
  const page = Math.max(Math.floor(Number(filters.page ?? 1) || 1), 1);

  // A repeated query parameter (?q=a&q=b) arrives as an array. The first value
  // is what the filter control displays, so it is the one applied here — an
  // array handed to sanitizeQuery() used to throw a TypeError into the
  // load-error card, and comparing price/status/category/rarity against an
  // array silently matched nothing.
  const one = (value: unknown): string | undefined =>
    Array.isArray(value)
      ? (value[0] as string | undefined)
      : (value as string | undefined);

  let query = supabase
    .from("badges")
    .select("*", { count: "exact", head: false });

  const requestedQ = one(filters.q);
  const q = requestedQ ? sanitizeQuery(requestedQ) : "";
  if (q) {
    query = query.or(
      `title.ilike.%${q}%,set_id.ilike.%${q}%,slug.ilike.%${q}%`,
    );
  } else if (requestedQ) {
    // The term survived as input but sanitized to nothing (only PostgREST
    // delimiters: "%", ",", "(", ")"). The control still displays it, so the grid
    // must not silently fall back to the whole catalog. `id is null` is a valid
    // filter that matches no row (id is a NOT NULL primary key) — an honest "no
    // results for this term".
    query = query.is("id", null);
  }
  const statusFilter = one(filters.status);
  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  const priceFilter = one(filters.price);
  if (priceFilter === "free") query = query.eq("is_paid", false);
  if (priceFilter === "paid") query = query.eq("is_paid", true);
  const categoryFilter = one(filters.category);
  if (categoryFilter && categoryFilter !== "all") {
    query = query.eq("category", categoryFilter);
  }
  const rarityFilter = one(filters.rarity);
  if (rarityFilter && rarityFilter !== "all") {
    query = query.eq("rarity_tier", rarityFilter);
  }

  const sort: SortKey = resolveSortKey(filters.sort);
  // No sort key here is unique — 471 of 476 rows share one `first_seen_at`,
  // 437 share one `end_date`, 163 share one `rarity_score` — so Postgres is
  // free to order equal keys differently between two requests, and an offset
  // window then repeats rows already served and drops others. Every sort gets
  // an `id` tiebreak, the same guard `getCatalogKeys` already carries.
  switch (sort) {
    case "oldest":
      query = query.order("first_seen_at", { ascending: true }).order("id");
      break;
    case "rarity":
      query = query.order("rarity_score", { ascending: false }).order("id");
      break;
    case "owners":
      query = query
        .order("owner_count", { ascending: false, nullsFirst: false })
        .order("id");
      break;
    case "ending":
      // A sort must never decide WHICH rows appear. The previous
      // `.not("end_date", "is", null)` silently dropped every badge without an
      // end date — on /active, whose default sort is "ending", that hid live
      // badges from the page entirely. Rows without a date now simply sort last.
      query = query
        .order("end_date", { ascending: true, nullsFirst: false })
        .order("id");
      break;
    case "releasing":
      query = query
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("id");
      break;
    case "name":
      query = query.order("title", { ascending: true }).order("id");
      break;
    default:
      query = query.order("first_seen_at", { ascending: false }).order("id");
  }

  query = query.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    // PostgREST rejects a window that starts past the end of the result set
    // (416 / PGRST103) rather than returning an empty page. Decide from the
    // real total instead of assuming every error is that one:
    //   * a filtered set with no rows at all is an empty page, not a failure —
    //     it used to re-throw, so `/badges?q=zzzzzznope&page=2` rendered the
    //     load-error card for a URL that was merely empty;
    //   * a stale `?page=` is served the last real page instead of a dead end;
    //   * anything else (a pooler hiccup, a statement timeout at that offset)
    //     is re-thrown as-is, because the old `Math.min(page, first.pages)`
    //     re-issued the *identical* failing request whenever `page` was already
    //     in range — an unbounded loop, not a retry.
    if (page > 1) {
      const first = await listBadges({ ...filters, page: 1 });
      if (first.total === 0) {
        return { items: [], total: 0, page: 1, perPage, pages: 1 };
      }
      if (page > first.pages) {
        return listBadges({ ...filters, page: first.pages });
      }
    }
    throw error;
  }

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));

  // A stale or hand-edited `?page=` beyond the range used to render an empty
  // page with no pagination at all — a dead end with no way back. Clamp to the
  // last page instead (the recursive call cannot loop: pages <= page then).
  if (page > pages && total > 0) {
    // The window is beyond the filtered set: serve the last real page instead
    // of a dead end (the recursion terminates because pages <= page there).
    return listBadges({ ...filters, page: pages });
  }
  if (page > 1 && (data ?? []).length === 0) {
    // PostgREST can report a zero count for a window beyond the data, so an
    // empty page needs one cheap first-page query to tell "past the end" from
    // "these filters match nothing". `first.pages !== page` keeps that retry
    // from re-issuing the identical request when the window really is empty.
    const first = await listBadges({ ...filters, page: 1 });
    if (first.total > 0 && first.pages !== page) {
      return listBadges({ ...filters, page: first.pages });
    }
  }

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
  const { data, error } = await supabase
    .from("badges")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  // A query failure is not the same answer as "no such slug": callers turn a
  // null row into notFound(), so a transient pooler hiccup used to publish a
  // 404 for a permanently valid badge page and hide the real error.
  if (error) throw error;
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
  // Newest-first for the limit, then reversed for the chart: ordering ascending
  // took the OLDEST 250 points, so a badge with a longer history showed a chart
  // that stopped updating weeks ago.
  const { data } = await supabase
    .from("badge_stats")
    .select("polled_at, owner_count, active_count")
    .eq("badge_id", badgeId)
    .order("polled_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as StatsPoint[]).reverse();
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
  // PostgREST caps a single response at 1000 rows and the old select had no
  // range, so this returned the categories of only the first 1000 badges in
  // `category` order — once the catalog passed 1000 rows, every
  // alphabetically-late category silently disappeared from the dropdown, with
  // no error anywhere. Page with `.range()` and an `id` tiebreak. A query
  // failure is thrown, not swallowed: the caller treats the category list as
  // decoration and renders the grid regardless.
  const pageSize = 1000;
  const set = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("badges")
      .select("category")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<{ category: string }>;
    for (const row of batch) if (row.category) set.add(row.category);
    if (batch.length < pageSize) break;
  }
  return [...set].sort();
}

export async function getProfileByUsername(
  username: string,
): Promise<ProfileRow | null> {
  // The username comes from the URL path and is used as a LIKE pattern, so its
  // wildcards must be escaped — `%` would otherwise match an arbitrary profile
  // and make maybeSingle() error on multiple rows.
  const pattern = username
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    // PostgREST aliases `*` to `%` in ilike.
    .replace(/\*/g, "\\*");
  const supabase = await createClient();
  // Explicit column list: the public role is granted SELECT per column, and
  // `twitch_id` is deliberately not among them. `select("*")` would be refused.
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_PUBLIC_COLUMNS)
    .ilike("username", pattern)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

/**
 * The columns the public API role may read from `profiles` (migration 0009/0010
 * grant SELECT per column). `twitch_id` is intentionally absent.
 */
export const PROFILE_PUBLIC_COLUMNS =
  "id, username, display_name, avatar_url, bio, color, banner_url, theme, " +
  "showcase_slots, inventory_public, created_at, updated_at, customization, " +
  "view_count, steal_enabled, steal_price, steal_max, mood, potat_level, " +
  "potatoes, potat_first_seen, potat_connections, twitch_created_at, role";

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

const CATALOG_KEY_COLUMNS =
  "id,slug,set_id,version,title,image_url_2x,category,is_paid,rarity_tier,rarity_score,status,end_date";

export async function getCatalogKeys(): Promise<CatalogKeyRow[]> {
  const supabase = await createClient();
  // pdat-7: `.limit(3000)` was a lie — PostgREST caps a single response at
  // 1000 rows, so this silently returned (and matched against) a truncated
  // catalog. Page with `.range()` until a short page proves the end. The `id`
  // tiebreak keeps the window stable when many rows share a rarity_score.
  const pageSize = 1000;
  const rows: CatalogKeyRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("badges")
      .select(CATALOG_KEY_COLUMNS)
      .neq("status", "removed")
      .order("rarity_score", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as CatalogKeyRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
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
    // pdat-7: aggregates come from SQL views, not a per-row select — a
    // per-row response is capped at 1000 by PostgREST, which truncated the
    // breakdowns once the catalog passed that size.
    supabase.from("stats_catalog_rarity").select("rarity_tier, count"),
    supabase.from("stats_catalog_categories").select("category, count"),
    supabase
      .from("badges")
      .select("*")
      .order("first_seen_at", { ascending: false })
      .limit(12),
  ]);

  const rarityDistribution: Record<string, number> = {};
  for (const row of (rarityRes.data ?? []) as Array<{
    rarity_tier: string;
    count: number | string;
  }>) {
    rarityDistribution[row.rarity_tier] = Number(row.count);
  }

  const categoryMap = new Map<string, number>();
  for (const row of (categoryRes.data ?? []) as Array<{
    category: string;
    count: number | string;
  }>) {
    categoryMap.set(row.category, Number(row.count));
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
