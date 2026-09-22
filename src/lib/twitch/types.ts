export type BadgeStatus = "active" | "upcoming" | "expired" | "removed";

export interface BadgeVersionSource {
  setId: string;
  version: string;
  title: string | null;
  description: string | null;
  imageUrl1x: string | null;
  imageUrl2x: string | null;
  imageUrl4x: string | null;
  clickAction: string | null;
  clickUrl: string | null;
}

export interface BadgeSetSource {
  setId: string;
  versions: BadgeVersionSource[];
}

/** badges.blog /api/perfil shape (Twitch GQL passthrough). */
export interface PerfilBadge {
  setID: string;
  version: string;
  title: string | null;
  description?: string | null;
  image1x: string | null;
  image2x: string | null;
  image4x: string | null;
  clickAction?: string | null;
  clickURL?: string | null;
}

export interface PerfilUser {
  id: string;
  login: string;
  displayName: string;
  profileImageURL: string;
  createdAt: string | null;
  isAffiliate?: boolean;
  badges: PerfilBadge[];
}

export interface PotatBadgeDistribution {
  badge: string;
  name: string | null;
  version: number | string;
  user_count: number;
  percentage: number | null;
  clickAction?: string | null;
  url?: string | null;
}

export interface PotatBadgeOwners {
  badge: string;
  name?: string | null;
  version: number | string;
  total_owners: number;
}

export interface PotatOwnedUser {
  twitch_id: string;
  owned_badges: number;
  rank: number;
  user_pfp: string | null;
  user_color: string | null;
  bestName: string;
}

export interface FeedBadge {
  sourceId: number | null;
  slug: string | null;
  name: string;
  imageUrl: string;
  category: string | null;
  isPaid: boolean | null;
  requirements: string;
  link: string;
  pubDate: string | null;
}

export interface FeedBadgeDetail {
  startDate: string | null;
  endDate: string | null;
  tags: string[];
}

export function badgeSlug(setId: string, version: string | number): string {
  const clean = setId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${clean || "badge"}-v${String(version).replace(/[^a-z0-9]+/gi, "-") || "1"}`;
}

export function badgeStatus(
  badge: { start_date: string | null; end_date: string | null },
  now: Date = new Date(),
): Exclude<BadgeStatus, "removed"> {
  if (badge.end_date && new Date(badge.end_date).getTime() < now.getTime())
    return "expired";
  if (
    badge.start_date &&
    new Date(badge.start_date).getTime() > now.getTime()
  )
    return "upcoming";
  return "active";
}

/**
 * Authoritative status resolution. A badge is 'active' if
 *  - badgebase's curated /active list confirms it (is_confirmed_active), or
 *  - it has a claim window and `now` is inside it.
 * A confirmed-active badge still only counts as 'upcoming' while its start
 * date lies in the future. Dateless, unconfirmed badges (subscriber, bits,
 * turbo, …) count as 'expired' — they are permanent states, not
 * currently-redeemable drops.
 *
 * The confirmed flag deliberately WINS over an elapsed end date: badgebase's
 * listing is the authority, and a stale/derived date in our own row must
 * never demote a badge that is currently redeemable.
 */
export function resolveStatus(
  badge: {
    start_date?: string | null;
    end_date?: string | null;
    is_confirmed_active?: boolean | null;
  },
  now: Date = new Date(),
): "active" | "upcoming" | "expired" {
  const startInFuture =
    !!badge.start_date &&
    new Date(badge.start_date).getTime() > now.getTime();

  if (badge.is_confirmed_active) return startInFuture ? "upcoming" : "active";

  if (badge.end_date && new Date(badge.end_date).getTime() < now.getTime())
    return "expired";
  if (startInFuture) return "upcoming";
  if (badge.start_date || badge.end_date) return "active";
  return "expired";
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/^twitchcon/, "twitchcon"],
  [/^(subtember|sub-tember)/, "subtember"],
  [/recap/, "recap"],
  [/pride/, "pride"],
  [/^ewc|esports|world.?cup|^msi|^evo|dreamhack|gamescom|^zl|la-?velada|zejvento|zendaya|zwsci|zevent/i, "esports"],
  [/^bits|^cheer/, "bits"],
  [/^(turbo|premium)/, "premium"],
  [/^(subscriber|founder|sub-?git|leader)/, "subscriber"],
  [/^(moderator|vip|broadcaster|staff|admin|global.?mod|ambassador|partner|verified|artist-badge|artist|game.?developer|extensions?|chat.?bot|clip.?champ|moments)/, "status"],
  [/^hype/, "hype-train"],
  [/^(bloom|blossom|watch|streak)/, "rewards"],
  [/drop|campaign|launch/i, "drops"],
];

export function guessCategory(setId: string): string {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(setId)) return category;
  }
  return "events";
}

/**
 * Role/status badges (moderator, VIP, broadcaster, staff, partner, …) are
 * permanent account states, not collectible drops — the catalog excludes
 * them entirely.
 */
export function isStatusSetId(setId: string): boolean {
  return /^(moderator|vip|broadcaster|staff|admin|global.?mod|ambassador|partner|verified|artist-badge|artist|game.?developer|extensions?|chat.?bot|clip.?champ|moments)([-_]|$)/i.test(
    setId,
  );
}

/**
 * Badges that require buying a ticket (TwitchCon & co.). Physical presence
 * + purchase makes them inherently scarce — rarity always pins them to
 * "legendary".
 */
export function isTicketBadge(
  setId: string,
  howToEarn?: string | null,
  description?: string | null,
): boolean {
  if (/twitchcon|ticket/i.test(setId)) return true;
  const text = `${howToEarn ?? ""} ${description ?? ""}`;
  return /bought?\s+(?:a\s+)?ticket|purchase\s+(?:a\s+)?ticket|buy\s+(?:a\s+)?ticket|kauf(?:e|en)?\s+(?:ein\s+)?ticket/i.test(
    text,
  );
}
