import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfileByUsername,
  getInventory,
  listBadges,
  type BadgeRow,
  type ProfileRow,
} from "@/lib/queries";
import { fetchUserBadges } from "@/lib/twitch/perfil";
import BadgeGrid from "@/components/badges/BadgeGrid";
import { BadgeImage } from "@/components/badges/BadgeImage";
import RarityChip from "@/components/badges/RarityChip";
import ShareButtons from "@/components/ShareButtons";
import TwitchLoginButton from "@/components/TwitchLoginButton";
import LevelBadge from "@/components/LevelBadge";
import RoleBadge from "@/components/RoleBadge";
import { isStaffRole } from "@/lib/roles";
import AchievementBadge from "@/components/AchievementBadge";
import CoinRainButton from "@/components/CoinRainButton";
import Coin from "@/components/Coin";
import StealPanel from "@/components/StealPanel";
import { readProgress } from "@/lib/gamification/xp";
import { getEconomy } from "@/lib/settings";
import { ProfileAutoRain, ProfileParticles, ProfileTilt } from "@/components/profile/ProfileEffects";
import { levelFromXp } from "@/lib/gamification/levels";
import CoinFlowCard, {
  coinFlowSince,
  fetchCoinRows,
  type CoinFlowRow,
} from "@/components/profile/CoinFlowCard";
import ActivityHeatmap from "@/components/profile/ActivityHeatmap";
import BestRoundsCard, {
  type BestRoundRow,
  type RecordHistoryEntry,
} from "@/components/profile/BestRoundsCard";
import ItemIcon, { ITEM_COLORS } from "@/components/items/ItemIcon";
import BuyFreezeButton from "@/components/items/BuyFreezeButton";
import { FREEZE_MAX } from "@/lib/gamification/items";
import { ACH_BY_ID } from "@/lib/gamification/achievements";
import { recordProfileVisit } from "@/lib/gamification/visits";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitorIpHash } from "@/lib/gamification/session";
import { localeAlternates } from "@/lib/seo";

interface PageProps {
  params: Promise<{ locale: string; username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale, username } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("profileTitle", { username });
  const description = t("profileDescription", { username });
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/profile/${username}`,
      languages: localeAlternates(`/profile/${username}`),
    },
    openGraph: {
      type: "profile",
      title,
      description,
      images: [
        {
          // ?month=1 unfurls the member's arcade-month share card instead of
          // the badge-collection card — the month card's share row uses it.
          // ?crash=1 (0081) swaps to the best Badge Rocket flight card.
          url:
            sp.month === "1"
              ? `/api/og/month?u=${encodeURIComponent(username)}&locale=${locale}`
              : sp.crash === "1"
                ? `/api/og/crash?u=${encodeURIComponent(username)}`
                : `/api/og/profile?u=${encodeURIComponent(username)}&locale=${locale}`,
        },
      ],
    },
    // Same layout contract as the blog page: without an explicit `twitter`
    // object the card headline is the site title, not the profile.
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// Cold item-shelf state (one freeze left): fixed snow-dot geometry as a
// module literal — no randomness during render (React Compiler purity rule;
// cf. ProfileEffects, which seeds post-mount in rAF). Identical on server
// and client, so hydration is stable.
const SNOW_DOTS = [
  { left: "7%", size: 4, delay: "-1.2s", duration: "9s" },
  { left: "26%", size: 3, delay: "-5.4s", duration: "11s" },
  { left: "48%", size: 5, delay: "-3.1s", duration: "8.5s" },
  { left: "69%", size: 3, delay: "-7.8s", duration: "10s" },
  { left: "88%", size: 4, delay: "-2.3s", duration: "12s" },
] as const;

export default async function ProfilePage({ params }: PageProps) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const ti = await getTranslations("inventory");
  const tg = await getTranslations("games");
  // The steal panel advertises the price the server will charge. The fallback for a
  // victim who never set their own must be the panel's configured economy, not a
  // hardcoded 100/250 — and with the same clamps `attemptSteal` applies.
  const economy = await getEconomy();

  let profile: ProfileRow | null = null;
  try {
    profile = await getProfileByUsername(username);
  } catch {
    profile = null;
  }

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwn = Boolean(viewer && profile && viewer.id === profile.id);

  // View counter with 5-minute per-IP reload block + visitor log.
  let latestVisitors: Array<{ username: string | null; avatar_url: string | null }> = [];
  if (profile) {
    // The view counter is best-effort. hashIp throws when no salt is configured
    // (a misconfigured env) and the blog page guards the identical call — a
    // missing hash must degrade to "not counted", never take down the page.
    let ipHash = "";
    try {
      ipHash = await visitorIpHash();
    } catch (error) {
      console.warn("[profile] visitor hash unavailable, not counting view:", error);
    }
    // Your own view of someone else's profile must not be counted, and the
    // visitor list is only shown to the profile owner: `profile_visits` is
    // owner-only under RLS, and reading it through the admin client for every
    // visitor published who had looked at whom.
    // `ipHash` is required for the 5-minute dedup: without it every visitor would
    // share one key and the window would suppress unrelated visits, so an
    // unavailable hash skips the count rather than recording under a bogus one.
    if (!isOwn && ipHash) {
      await recordProfileVisit(profile.id, viewer?.id ?? null, ipHash).catch(() => false);
    }
    if (isOwn) {
      const admin = createAdminClient();
      const { data: visitorRows } = await admin
        .from("profile_visits")
        .select("visitor:profiles(username, avatar_url)")
        .eq("profile_id", profile.id)
        .not("visitor_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(12);
      latestVisitors = (visitorRows ?? []).map(
        (row) => (Array.isArray(row?.visitor) ? row.visitor[0] : row?.visitor),
      ) as typeof latestVisitors;
    }
  }

  // Resolved live for non-member profiles (ephemeral view + claim CTA).
  let liveBadges: Array<{ slug: string; setId: string; version: string; title: string; image: string | null; tier: BadgeRow["rarity_tier"] | null }> = [];
  let liveAvatar: string | null = null;
  let liveDisplayName: string | null = null;
  if (!profile) {
    try {
      const perfil = await fetchUserBadges(decodeURIComponent(username), 900);
      liveAvatar = perfil.profileImageURL || null;
      liveDisplayName = perfil.displayName;
      const { data: catalog } = await supabase
        .from("badges")
        .select("id,slug,set_id,version,title,image_url_2x,rarity_tier")
        .neq("status", "removed");
      const byKey = new Map(
        (catalog ?? []).map((row) => [
          `${row.set_id}:${row.version}`,
          row as {
            id: string;
            slug: string;
            set_id: string;
            version: string;
            title: string;
            image_url_2x: string | null;
            rarity_tier: BadgeRow["rarity_tier"];
          },
        ]),
      );
      liveBadges = perfil.badges
        .map((b) => {
          const match = byKey.get(`${b.setID}:${b.version}`);
          if (!match) return null;
          return {
            slug: match.slug,
            setId: b.setID,
            version: b.version,
            title: b.title ?? match.title,
            image: b.image2x ?? match.image_url_2x,
            tier: match.rarity_tier,
          };
        })
        .filter(
          (entry): entry is {
            slug: string;
            setId: string;
            version: string;
            title: string;
            image: string | null;
            tier: BadgeRow["rarity_tier"];
          } => entry !== null,
        )
        .sort((a, b) => a.tier.localeCompare(b.tier));
    } catch {
      notFound();
    }
  }

  if (!profile && liveBadges.length === 0 && !liveAvatar) notFound();

  const displayName =
    profile?.display_name ?? liveDisplayName ?? decodeURIComponent(username);
  const avatar = profile?.avatar_url ?? liveAvatar;
  const handle = profile?.username ?? decodeURIComponent(username).toLowerCase();

  // The customizer stores ~35 settings in `profiles.customization`; until fp-3
  // the public profile applied NONE of them. Every one is honoured now. The
  // defaults mirror the customizer's own DEFAULTS, so a member who never opened
  // it sees exactly the un-customized look.
  const customization = (profile?.customization ?? {}) as Record<string, unknown>;
  const flag = (key: string, fallback: boolean) =>
    typeof customization[key] === "boolean"
      ? (customization[key] as boolean)
      : fallback;
  const text = (key: string, fallback = "") =>
    typeof customization[key] === "string" && (customization[key] as string).trim()
      ? (customization[key] as string)
      : fallback;
  const num = (key: string, fallback: number) =>
    typeof customization[key] === "number" &&
    Number.isFinite(customization[key] as number)
      ? (customization[key] as number)
      : fallback;
  const one = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = customization[key];
    return typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  };
  const hex = (value: string, fallback: string) =>
    /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

  const showStats = flag("showStats", true);
  const showInventory = flag("showInventory", true);
  const showLevel = flag("showLevel", true);
  const showCoins = flag("showCoins", true);
  const showVisitors = flag("showVisitors", true);
  // Arcade-statistics tiles (0073): each statistic is individually hideable,
  // default visible — the same show* semantics as the five flags above.
  const showStatWagered = flag("showStatWagered", true);
  const showStatWon = flag("showStatWon", true);
  const showStatLost = flag("showStatLost", true);
  const showStatNet = flag("showStatNet", true);
  const showStatRounds = flag("showStatRounds", true);
  const showStatWins = flag("showStatWins", true);
  const showStatWinRate = flag("showStatWinRate", true);
  const showStatBestRound = flag("showStatBestRound", true);
  const showStatJackpots = flag("showStatJackpots", true);
  const showStatWheel = flag("showStatWheel", true);
  const showStatSteals = flag("showStatSteals", true);
  const showStatRobbed = flag("showStatRobbed", true);
  const showStatLoginStreak = flag("showStatLoginStreak", true);
  const showStatAchievements = flag("showStatAchievements", true);
  // The month-summary sentence above the tiles (hideable like every tile).
  const showMonthSummary = flag("showMonthSummary", true);
  // Only a comma-separated list of hex colours is accepted, so the value cannot
  // smuggle arbitrary CSS into a style attribute.
  const nameGradientRaw = text("nameGradient");
  const nameGradient = /^#[0-9a-fA-F]{3,8}(,\s*#[0-9a-fA-F]{3,8})+$/.test(
    nameGradientRaw,
  )
    ? nameGradientRaw
    : "";
  const bannerOverlay = Math.min(90, Math.max(0, num("bannerOverlay", 0)));
  // The account page writes the colour BOTH to the column and the document;
  // the column is the source of truth, so a member who set it there before the
  // customizer existed still gets their colour.
  const customColor = hex(profile?.color ?? text("color"), "#a970ff");
  const accent2 = hex(text("accent2"), "#60a5fa");
  const font = one("font", ["sans", "serif", "mono", "rounded"] as const, "sans");
  const cardStyle = one("cardStyle", ["glass", "solid", "outline"] as const, "glass");
  const radius = one("radius", ["sharp", "soft", "round"] as const, "soft");
  const avatarFrame = one("avatarFrame", ["none", "ring", "double", "glow", "crown"] as const, "none");
  const showcaseLayout = one("showcaseLayout", ["grid", "row", "carousel"] as const, "grid");
  const density = one("density", ["cozy", "compact"] as const, "cozy");
  const profileTheme = one("profileTheme", ["auto", "violet", "emerald", "sapphire", "gold"] as const, "auto");
  const effectsIntensity = one("effectsIntensity", ["off", "subtle", "full"] as const, "subtle");
  // "off" wins over every individual toggle: it is the master switch.
  const fxOn = effectsIntensity !== "off";
  const aura = fxOn && flag("aura", false);
  const particles = fxOn && flag("particles", false);
  const nameRainbow = flag("nameRainbow", false);
  const bannerShine = flag("bannerShine", true);
  const tilt3d = fxOn && flag("tilt3d", false);
  const pixelAvatar = flag("pixelAvatar", false);
  const achievementTicker = flag("achievementTicker", true);
  const greetingBanner = flag("greetingBanner", true);
  const levelHalo = hex(text("levelHalo"), "#a970ff");
  const cursorBadge = flag("cursorBadge", false);
  const statusBubble = text("statusBubble").slice(0, 120);
  const coinRainAuto = fxOn && flag("coinRainAuto", false);
  const visitorMarquee = flag("visitorMarquee", true);
  const memberTitle = text("title").slice(0, 64);
  const socialTwitter = text("socialTwitter").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
  const socialDiscord = text("socialDiscord").replace(/[^A-Za-z0-9._]/g, "").slice(0, 32);

  // The theme only re-maps the accent inside the profile; "auto" keeps the
  // member's own custom colour as the accent when they set one.
  const themeClass =
    profileTheme === "auto" ? "" : `pf-theme-${profileTheme}`;
  const rootAccentVars =
    profileTheme === "auto"
      ? { "--pf-accent": customColor, "--pf-accent-2": accent2 }
      : undefined;

  // Member data: showcase + inventory.
  let showcaseBadges: BadgeRow[] = [];
  let ownedBadges: BadgeRow[] = [];
  let totalCatalog = 0;
  let inventoryVisible = false;
  if (profile) {
    // The owner always sees their own inventory; the toggle only gates what
    // OTHER visitors see.
    inventoryVisible = isOwn || (profile.inventory_public && showInventory);
    const [catalog, inventory] = await Promise.all([
      listBadges({ perPage: 12, sort: "rarity" }).catch(() => null),
      inventoryVisible ? getInventory(profile.id).catch(() => []) : Promise.resolve([]),
    ]);
    totalCatalog = catalog?.total ?? 0;
    ownedBadges = inventory
      .map((item) => item.badge)
      .filter(Boolean) as BadgeRow[];

    const slugs = Array.isArray(profile.showcase_slots)
      ? profile.showcase_slots.slice(0, 6)
      : [];
    if (slugs.length > 0) {
      const { data: rows } = await supabase
        .from("badges")
        .select("*")
        .in("slug", slugs);
      const bySlug = new Map(
        ((rows ?? []) as BadgeRow[]).map((row) => [row.slug, row]),
      );
      showcaseBadges = slugs
        .map((slug) => bySlug.get(slug))
        .filter(Boolean) as BadgeRow[];
    }
  }

  const percent =
    profile && totalCatalog > 0
      ? Math.round((ownedBadges.length / totalCatalog) * 100)
      : 0;

  // Gamification: level (badge ALWAYS visible), coins, achievements, visitors.
  let progress: Awaited<ReturnType<typeof readProgress>> = null;
  let level = null as ReturnType<typeof levelFromXp> | null;
  let unlockedAchievements: Array<{ achievement_id: string; unlocked_at: string }> = [];
  let itemFreezes: number | null = null;
  let rescueDates: string[] = [];
  // Total rescues = the Ice Guardian signal (same count buildStats uses).
  let guardianRescues = 0;
  // Feed-logged coin movements of the last 30 UTC days (the coin-flow card).
  let coinRows: CoinFlowRow[] = [];
  let bestRows: BestRoundRow[] = [];
  let recordHistory: RecordHistoryEntry[] = [];
  // Progressive-jackpot wins (0069) + the TRUE achievement count (the 25-row
  // read above caps the visible list, the head count does not).
  let jackpotWins: Array<{ kind: string; amount: number }> = [];
  let achievementCount = 0;
  // 7-day trend inputs (the grid's delta chips).
  let weekRounds: Array<{ bet: number; payout: number; created_at: string; game: string }> = [];
  let weekJackpotWins = 0;
  // The community's rolling-month wagered total (the share clause).
  let communityWagered = 0;
  let monthRank = 0;
  // Owner-only rank chips: rank per metric (1 + players with a HIGHER value)
  // and the player total. Null when progress is missing or the counts fail.
  let statRanks: Record<
    "wagered" | "won" | "rounds" | "streak",
    { rank: number; total: number; toNext: number | null }
  > | null = null;
  if (profile) {
    const admin = createAdminClient();
    // Activity window: 60 days so the month summary can compare against the
    // prior month; the strips (30d) and the trend chips (7d) slice their own
    // sub-windows in JS. A heavy player's 60 days stays under the 1000-row
    // PostgREST cap at this site's scale.
    const windowCutoff = new Date(
      // eslint-disable-next-line react-hooks/purity
      Date.now() - 60 * 86_400_000,
    ).toISOString();
    const weekCutoff = new Date(
      // eslint-disable-next-line react-hooks/purity
      Date.now() - 7 * 86_400_000,
    ).toISOString();
    // 30 rendered UTC days starting today-29 (the card strip's window).
    const since = coinFlowSince();
    const [progressRow, achievementRes, itemsRes, rescuesRes, rescuesCountRes, coinsRes, bestRes, historyRes, jackpotRes, achCountRes, weekRoundsRes, weekJackpotRes, communityMonthRes, monthTopRes] = await Promise.all([
      readProgress(profile.id).catch(() => null),
      admin
        .from("user_achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", profile.id)
        .order("unlocked_at", { ascending: false })
        .limit(25),
      // user_items is service-role-write only (0049, no policies); the public
      // profile reads it the same way it reads user_achievements.
      admin
        .from("user_items")
        .select("item_key, quantity")
        .eq("user_id", profile.id)
        .eq("item_key", "streak_freeze")
        .maybeSingle(),
      // Rescue history: activity_events user_id/payload are NOT anon-readable
      // (0040 column grants), so this filter needs the service-role client —
      // same split as the items read above. The (user_id, created_at desc)
      // index serves the top-3.
      admin
        .from("activity_events")
        .select("created_at")
        .eq("user_id", profile.id)
        .eq("kind", "streak_freeze")
        .order("created_at", { ascending: false })
        .limit(3),
      admin
        .from("activity_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .eq("kind", "streak_freeze"),
      // Feed-logged coin movements, 30d window (the coin-flow card). Same
      // admin-client split as above — user_id is not anon-readable (0040).
      fetchCoinRows(admin, profile.id, since).catch(() => []),
      // Best single-round net per played game (view 0055): one aggregate read
      // instead of paging a lifetime of rounds. Anon-granted; admin works too.
      admin
        .from("stats_player_best_rounds")
        .select("game,best_net,rounds")
        .eq("user_id", profile.id)
        .order("best_net", { ascending: false }),
      // Record-break history for the card (RPC 0056): the last five rounds
      // that beat every prior round, most recent first. Invoker rights —
      // game_rounds is public-read.
      admin.rpc("player_record_history", { p_user: profile.id, p_limit: 5 }),
      // Jackpot wins are public history (0069) — one read gives count AND the
      // coin total; kind splits mega from game pots if ever displayed.
      admin.from("jackpot_wins").select("kind,amount").eq("user_id", profile.id),
      admin
        .from("user_achievements")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id),
      // 7-day trend window for the arcade grid's delta chips: one read of
      // the week's settled rounds (bet + payout feed the wagered/won/lost/
      // rounds deltas), plus the week's jackpot wins. game_rounds rides the
      // (user_id, created_at desc) index; a week of play is far below the
      // 1000-row PostgREST cap for any realistic player.
      admin
        .from("game_rounds")
        .select("bet,payout,created_at,game")
        .eq("user_id", profile.id)
        .gte("created_at", windowCutoff)
        .limit(1000),
      admin
        .from("jackpot_wins")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .gte("created_at", weekCutoff),
      // The community's rolling month (0076/0077 public view) for the
      // share-of-community clause — anon-granted; admin works too.
      admin.from("stats_arcade_month").select("wagered_30d").maybeSingle(),
      // Hall of the month (0078/0079, top 10): the member's rank for the
      // "#X of the month" chip — anon-granted; admin works too.
      admin.from("stats_arcade_month_top").select("username"),
    ]);
    const achievementRows = (achievementRes.data ?? []) as Array<{
      achievement_id: string;
      unlocked_at: string;
    }>;
    progress = progressRow;
    // `readProgress` never creates a row, so a member who has not played yet
    // has none — the level badge is documented as ALWAYS visible, so fall back to
    // the level-1 display instead of hiding it.
    level = levelFromXp(progressRow?.xp ?? 0);
    unlockedAchievements = achievementRows;
    itemFreezes =
      (itemsRes.data as { quantity: number } | null)?.quantity ?? null;
    rescueDates = ((rescuesRes.data ?? []) as Array<{ created_at: string }>).map(
      (row) => row.created_at,
    );
    guardianRescues = rescuesCountRes.count ?? 0;
    coinRows = coinsRes;
    bestRows = (bestRes.data ?? []) as BestRoundRow[];
    recordHistory = (historyRes.data ?? []) as RecordHistoryEntry[];
    jackpotWins = ((jackpotRes.data ?? []) as Array<{ kind: string; amount: string | number }>).map(
      (row) => ({ kind: row.kind, amount: Number(row.amount ?? 0) }),
    );
    achievementCount = achCountRes.count ?? 0;
    weekRounds = ((weekRoundsRes.data ?? []) as Array<{
      bet: string | number;
      payout: string | number;
      created_at: string;
      game: string;
    }>).map((row) => ({
      bet: Number(row.bet ?? 0),
      payout: Number(row.payout ?? 0),
      created_at: row.created_at,
      game: row.game,
    }));
    weekJackpotWins = weekJackpotRes.count ?? 0;
    communityWagered = Number(
      ((communityMonthRes.data as { wagered_30d?: string | number } | null) ?? {})?.wagered_30d ?? 0,
    );
    // Month rank from the top-10 view (0079): 0 = not ranked this month.
    monthRank =
      ((monthTopRes.data ?? []) as Array<{ username: string }>)
        .map((row) => row.username)
        .indexOf(profile.username) + 1;
    // Rank chips (fetched for every visitor, rendered isOwn only): four
    // indexed head-counts over public-read user_progress + the player total.
    if (progressRow) {
      const rankRes = await Promise.all([
        admin.from("user_progress").select("user_id", { count: "exact", head: true }).gt("coins_wagered", progressRow.coins_wagered),
        admin.from("user_progress").select("user_id", { count: "exact", head: true }).gt("coins_won", progressRow.coins_won),
        admin.from("user_progress").select("user_id", { count: "exact", head: true }).gt("games_played", progressRow.games_played),
        admin.from("user_progress").select("user_id", { count: "exact", head: true }).gt("best_game_streak", progressRow.best_game_streak),
        admin.from("user_progress").select("user_id", { count: "exact", head: true }),
        // Next-rank values (the smallest value above mine, one read per
        // ranked metric) — powers the '+N to #rank-1' hint. Null when the
        // member already tops the metric.
        admin.from("user_progress").select("coins_wagered").gt("coins_wagered", progressRow.coins_wagered).order("coins_wagered", { ascending: true }).limit(1).maybeSingle(),
        admin.from("user_progress").select("coins_won").gt("coins_won", progressRow.coins_won).order("coins_won", { ascending: true }).limit(1).maybeSingle(),
        admin.from("user_progress").select("games_played").gt("games_played", progressRow.games_played).order("games_played", { ascending: true }).limit(1).maybeSingle(),
        admin.from("user_progress").select("best_game_streak").gt("best_game_streak", progressRow.best_game_streak).order("best_game_streak", { ascending: true }).limit(1).maybeSingle(),
      ] as PromiseLike<{ count: number | null } | { [k: string]: number | string | null }>[])
        .then((rs) => rs.map((r) => {
          // Every member resolves to the RESULT OBJECT (the supabase-js v2
          // await shape): count queries carry .count; maybeSingle carries
          // .data (the row) or null when no row matched.
          const res = r as { count?: number | null; data?: Record<string, unknown> | null };
          if (typeof res.count === "number") return res.count;
          if (res.count === null || res.count === undefined) {
            const row = res.data;
            if (!row) return null;
            const value = Object.values(row)[0];
            return value === null || value === undefined ? null : Number(value);
          }
          return null;
        }))
        .catch(() => null);
      const [aboveWagered, aboveWon, aboveRounds, aboveStreak, totalPlayers, nextWagered, nextWon, nextRounds, nextStreak] = rankRes ?? [];
      if (rankRes != null) {
        const toNext = (mine: number, next: number | null | undefined) =>
          typeof next === "number" && Number.isFinite(next) && next > mine
            ? Math.ceil(next - mine)
            : null;
        // The mapped wave mixes counts (number) and maybeSingle values
        // (number | null); coerce the four counts + total defensively.
        const nz = (v: number | null | undefined) => Number(v ?? 0);
        statRanks = {
          wagered: { rank: nz(aboveWagered) + 1, total: nz(totalPlayers), toNext: toNext(progressRow.coins_wagered, nextWagered) },
          won: { rank: nz(aboveWon) + 1, total: nz(totalPlayers), toNext: toNext(progressRow.coins_won, nextWon) },
          rounds: { rank: nz(aboveRounds) + 1, total: nz(totalPlayers), toNext: toNext(progressRow.games_played, nextRounds) },
          streak: { rank: nz(aboveStreak) + 1, total: nz(totalPlayers), toNext: toNext(progressRow.best_game_streak, nextStreak) },
        };
      }
    }
  }


  // Arcade-statistics inputs (0073): played/wagered read from progress, best
  // single round from the already-fetched per-game view rows. arcadeActive
  // keeps a never-played member's grid hidden entirely (false-zeros doctrine);
  // inside the grid, tiles still hide individually when their activity is 0.
  const played = progress?.games_played ?? 0;
  const wagered = progress?.coins_wagered ?? 0;
  const wonTotal = progress?.coins_won ?? 0;
  const lostTotal = progress?.coins_lost ?? 0;
  const netTotal = wonTotal - lostTotal;
  const bestNet = Math.max(0, ...bestRows.map((row) => Number(row.best_net ?? 0)));
  const stealAttempts = (progress?.steals_successful ?? 0) + (progress?.steals_failed ?? 0);
  const arcadeActive =
    !!progress &&
    (played > 0 ||
      (progress.wheel_spins ?? 0) > 0 ||
      stealAttempts > 0 ||
      (progress.times_robbed ?? 0) > 0 ||
      jackpotWins.length > 0);
  const fmtNum = (value: number) => value.toLocaleString(locale);
  // The trend read now covers 30 days (the tile strips): re-derive the
  // 7-day window from created_at before computing the delta chips.
  // Local re-derivation: weekCutoff lives inside the if(profile) block above.
  const week7Start = new Date(
    // eslint-disable-next-line react-hooks/purity
    Date.now() - 7 * 86_400_000,
  ).toISOString();
  const weekRounds7 = weekRounds.filter((r) => r.created_at >= week7Start);
  // 7-day deltas for the trend chips: coins wagered = sum of the week's
  // stakes, won/lost = the signed halves of the week's nets (the same split
  // the lifetime counters use), rounds = count, wins = positive nets.
  const weekWagered = weekRounds7.reduce((sum, r) => sum + r.bet, 0);
  const weekWon = weekRounds7.reduce((sum, r) => sum + Math.max(0, r.payout - r.bet), 0);
  const weekLost = weekRounds7.reduce((sum, r) => sum + Math.max(0, r.bet - r.payout), 0);
  const weekNet = weekWon - weekLost;
  const weekRoundsCount = weekRounds7.length;
  const weekWinsCount = weekRounds7.filter((r) => r.payout > r.bet).length;
  // 30-day daily activity series for the tile strips (zero-fill is CORRECT
  // for flows: a day with no rounds is 0 activity). One bucket per UTC day,
  // oldest first, capped at 30 entries.
  const dayBuckets = new Map<
    string,
    { wagered: number; won: number; lost: number; rounds: number; best: number }
  >();
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(
      // eslint-disable-next-line react-hooks/purity
      Date.now() - i * 86_400_000,
    ).toISOString().slice(0, 10);
    dayBuckets.set(d, { wagered: 0, won: 0, lost: 0, rounds: 0, best: 0 });
  }
  for (const r of weekRounds) {
    const key = r.created_at.slice(0, 10);
    const b = dayBuckets.get(key);
    if (!b) continue;
    b.wagered += r.bet;
    b.won += Math.max(0, r.payout - r.bet);
    b.lost += Math.max(0, r.bet - r.payout);
    b.rounds += 1;
    b.best = Math.max(b.best, r.payout - r.bet);
  }
  const strip = (key: "wagered" | "won" | "lost" | "rounds") =>
    [...dayBuckets.values()].map((b) => b[key]);
  // Month summary (the "Saisonrueckblick" sentence). monthStart is a local
  // re-derivation (the if-block's cutoffs are block-scoped): the current
  // month is the 30d slice of the 60d read, the prior month the rest.
  const monthStart = new Date(
    // eslint-disable-next-line react-hooks/purity
    Date.now() - 30 * 86_400_000,
  ).toISOString();
  const monthRounds = weekRounds.filter((r) => r.created_at >= monthStart);
  const priorRounds = weekRounds.filter((r) => r.created_at < monthStart);
  const monthWagered = monthRounds.reduce((sum, r) => sum + r.bet, 0);
  const monthWon = monthRounds.reduce((sum, r) => sum + Math.max(0, r.payout - r.bet), 0);
  const monthLost = monthRounds.reduce((sum, r) => sum + Math.max(0, r.bet - r.payout), 0);
  const monthNet = monthWon - monthLost;
  const monthWins = monthRounds.filter((r) => r.payout > r.bet).length;
  const monthActive = monthRounds.length > 0;
  // Prior-month comparison: only when the prior month had real volume (a
  // first active month is a beginning, not a spike); |pct| < 5 reads flat.
  const priorWagered = priorRounds.reduce((sum, r) => sum + r.bet, 0);
  const monthCompare = (() => {
    if (priorWagered < 100 || monthWagered <= 0) return null;
    const pct = Math.round(((monthWagered - priorWagered) / priorWagered) * 100);
    if (Math.abs(pct) < 5) return { kind: "flat" as const, pct };
    return pct > 0
      ? { kind: "up" as const, pct }
      : { kind: "down" as const, pct: -pct };
  })();
  // Best round of the month (the emotional peak, not a sum).
  const monthBest = monthRounds.reduce<(typeof monthRounds)[number] | null>((best, r) => {
    const net = r.payout - r.bet;
    return net > 0 && (!best || net > best.payout - best.bet) ? r : best;
  }, null);
  // Heatmap intensity over the same 30 buckets the strips read.
  // Best rolling 7-day window (net): sort the month's rounds by time and
  // slide a 7-day window — the "best week" the monthly net can hide.
  const monthSorted = [...monthRounds].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );
  let bestWeekNet = 0;
  for (let i = 0; i < monthSorted.length; i += 1) {
    let windowNet = 0;
    for (let j = i; j < monthSorted.length &&
      Date.parse(monthSorted[j].created_at) - Date.parse(monthSorted[i].created_at) < 7 * 86_400_000; j += 1) {
      windowNet += monthSorted[j].payout - monthSorted[j].bet;
    }
    bestWeekNet = Math.max(bestWeekNet, windowNet);
  }
  // Best banked Badge Rocket cash-out (0081 view): feeds the crash share row
  // — previewed only at 10x+ (moon altitude), shareable at 25x+ (the OG card
  // spec). Public aggregate, anon-granted; a quiet pilot simply hides it.
  let crashBest: { mult: number; payout: number } | null = null;
  if (profile?.username) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("stats_crash_top_cash")
        .select("best_mult,best_payout")
        .eq("username", profile.username)
        .maybeSingle();
      if (data) {
        const mult = Number((data as Record<string, unknown>).best_mult ?? 0);
        const payout = Number((data as Record<string, unknown>).best_payout ?? 0);
        if (mult >= 10) crashBest = { mult, payout };
      }
    } catch {
      crashBest = null;
    }
  }
  // Share of the community's wagered month: only when both sides have real
  // volume and the share is at least half a percent (a 0.1% is noise).
  const monthShare =
    communityWagered >= 1000 && monthWagered >= 100 && monthWagered / communityWagered >= 0.005
      ? monthWagered / communityWagered
      : null;
  const heatMax = Math.max(1, ...[...dayBuckets.values()].map((b) => b.rounds));
  const heatLevel = (n: number) =>
    n === 0 ? "0" : n >= heatMax ? "max" : n === 1 ? "1" : n <= 3 ? "2" : "3";
  // The heatmap island's payload: precomputed cells (level + accessible
  // label) and the month's rounds grouped by UTC day with SERVER-localized
  // game titles — the client island must not import GAMES (service-role
  // boundary), so titles ship as props (the StealPanel doctrine).
  const heatCells = [...dayBuckets.entries()].map(([day, b]) => ({
    day,
    rounds: b.rounds,
    level: heatLevel(b.rounds),
    label:
      b.rounds === 0
        ? `${day}: 0`
        : `${day}: ${b.rounds} · ${
            b.won - b.lost >= 0 ? "+" : "−"
          }${fmtNum(Math.abs(b.won - b.lost))} · best +${fmtNum(b.best)}`,
  }));
  const heatDays: Record<
    string,
    Array<{ title: string; bet: number; payout: number }>
  > = {};
  for (const r of monthRounds) {
    const key = r.created_at.slice(0, 10);
    if (!dayBuckets.has(key)) continue;
    (heatDays[key] ??= []).push({
      title: tg(`${r.game}Title`),
      bet: r.bet,
      payout: r.payout,
    });
  }
  // The per-tile delta chip: '+N this week' in green when the week moved the
  // number up, hidden when the week was quiet (a zero delta is noise, not a
  // trend — the false-zeros doctrine applied to time).
  // '#N of M' chip for the owner's own view; rendered inside the tiles that
  // have a rank and are visible.
  // 30-day activity mini strip under a tile: 30 bars, heights normalized to
  // the series max, tinted by direction where the metric has one. aria-hidden
  // decoration — the trend chip above carries the information.
  const miniStrip = (key: "wagered" | "won" | "lost" | "rounds") => {
    const series = strip(key);
    if (series.every((v) => v === 0)) return null;
    const max = Math.max(1, ...series);
    const dir = key === "won" ? "in" : key === "lost" ? "out" : undefined;
    return (
      <span className="coin-flow-bars coin-flow-bars-sm" aria-hidden="true">
        {series.map((value, i) => {
          const pct = value === 0 ? 0 : Math.max(8, Math.round((value / max) * 100));
          return (
            <span
              key={i}
              className="coin-flow-bar"
              data-dir={dir}
              style={{ height: pct + "%" }}
            />
          );
        })}
      </span>
    );
  };
  const rankChip = (key: keyof NonNullable<typeof statRanks>) =>
    isOwn && statRanks && statRanks[key].rank <= statRanks[key].total ? (
      <span className="chip pointer-events-none mt-1 flex-col items-center text-[0.5625rem]">
        <span>
          #{statRanks[key].rank} / {fmtNum(statRanks[key].total)}
        </span>
        {statRanks[key].rank > 1 && statRanks[key].toNext !== null ? (
          <span className="text-muted">
            +{fmtNum(statRanks[key].toNext as number)} {t("statToNext", { rank: statRanks[key].rank - 1 })}
          </span>
        ) : null}
      </span>
    ) : null;
  const trendChip = (value: number) =>
    value > 0 ? (
      <span dir="ltr" className="stat-trend text-success">
        +{fmtNum(value)} {t("statThisWeek")}
      </span>
    ) : null;

  return (
    <div
      className={[
        "space-y-8",
        font !== "sans" ? `pf-font-${font}` : "",
        cardStyle !== "glass" ? `pf-cards-${cardStyle}` : "",
        radius !== "soft" ? `pf-radius-${radius}` : "",
        density === "compact" ? "pf-density-compact" : "",
        themeClass,
        effectsIntensity !== "subtle" ? `pf-fx-${effectsIntensity}` : "pf-fx-subtle",
        cursorBadge ? "pf-cursor-badge" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={rootAccentVars as React.CSSProperties | undefined}
    >
      {/* Banner + identity */}
      <section className="card overflow-hidden">
        <div
          className={`pf-banner-root h-28 bg-accent-soft sm:h-36 ${bannerShine ? "pf-banner-shine" : ""}`}
          style={
            profile?.banner_url
              ? {
                  backgroundImage: `url(${profile.banner_url})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          {bannerOverlay > 0 ? (
            <span
              aria-hidden
              className="block h-full w-full bg-background"
              style={{ opacity: bannerOverlay / 100 }}
            />
          ) : null}
          {particles ? <ProfileParticles accent={customColor} /> : null}
          {coinRainAuto ? <ProfileAutoRain accent={customColor} /> : null}
        </div>
        <ProfileTilt enabled={tilt3d}>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <div
            className={[
              "-mt-10 shrink-0 rounded-full border-4 border-surface bg-surface",
              avatarFrame !== "none" ? `pf-avatar-${avatarFrame}` : "",
              aura ? "pf-aura" : "",
              pixelAvatar ? "pf-avatar-pixel" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={handle} width={88} height={88} className="rounded-full" />
            ) : (
              <span className="grid size-[88px] place-items-center rounded-full bg-accent-soft text-2xl font-bold text-accent">
                {handle.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              {level && showLevel && (
                <LevelBadge level={level.level} size={64} halo={`${levelHalo}66`} />
              )}
              <div className="min-w-0">
                <h1
                  className={`truncate text-2xl font-extrabold tracking-tight ${nameRainbow ? "pf-name-rainbow" : ""}`}
                  style={
                    nameGradient && !nameRainbow
                      ? {
                          backgroundImage: `linear-gradient(90deg, ${nameGradient})`,
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          color: "transparent",
                        }
                      : undefined
                  }
                >
                  {displayName}
                </h1>
                {isStaffRole(profile?.role) ? (
                  <div className="mt-1.5">
                    <RoleBadge role={profile.role} />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm text-muted">@{handle}</p>
                  {memberTitle && (
                    <p className="text-xs font-semibold" style={{ color: "var(--pf-accent, var(--accent))" }}>
                      {memberTitle}
                    </p>
                  )}
                  {socialTwitter && (
                    <a
                      href={`https://x.com/${socialTwitter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted hover:text-foreground"
                      aria-label={`${t("socialTwitterLabel")}: @${socialTwitter}`}
                      title={`@${socialTwitter}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
                        <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2H8l4.4 5.9L18.9 2zm-1.1 18h1.7L7.1 3.8H5.3L17.8 20z" />
                      </svg>
                    </a>
                  )}
                  {socialDiscord && (
                    <a
                      href={`https://discord.com/users/${socialDiscord}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted hover:text-foreground"
                      aria-label={`${t("socialDiscordLabel")}: ${socialDiscord}`}
                      title={socialDiscord}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
                        <path d="M20.3 4.4A19.8 19.8 0 0 0 15.9 3l-.6 1.2a16 16 0 0 0-6.6 0L8.1 3a19.8 19.8 0 0 0-4.4 1.4C.9 9.1.3 13.7.6 18.2a20 20 0 0 0 6 3l1.2-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 11.4 0l.5.4a12.9 12.9 0 0 1-2 1l1.2 2a20 20 0 0 0 6-3c.4-5.2-.6-9.7-3.1-13.8zM8.7 15.5c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.2 1 2.2 2.3-1 2.3-2.2 2.3zm6.6 0c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.2 1 2.2 2.3-1 2.3-2.2 2.3z" />
                      </svg>
                    </a>
                  )}
                </div>
                {statusBubble && <p className="pf-status-bubble">{statusBubble}</p>}
              </div>
            </div>
            {level && showLevel && (
              <div className="mt-2 max-w-xs">
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(level.progress * 100)}%` }} />
                </div>
                <p className="mt-1 text-[0.6875rem] text-muted tabular-nums">
                  {t("level")} {level.level} · {level.xpIntoLevel}/{level.xpForNext || "∞"} XP
                  {progress && showCoins ? (
                    <span>
                      {" · "}
                      <span className="inline-flex items-center gap-1">
                        {progress.coins.toLocaleString(locale)} <Coin size={13} />
                      </span>
                    </span>
                  ) : null}
                </p>
              </div>
            )}
            {progress && showCoins && !showLevel && (
              <p className="mt-2 text-[0.6875rem] text-muted tabular-nums">
                <span className="inline-flex items-center gap-1">
                  {progress.coins.toLocaleString(locale)} <Coin size={13} />
                </span>
              </p>
            )}
            {profile?.mood && (
              <p className="mt-2 inline-block rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-semibold">
                {String(profile.mood)}
              </p>
            )}
            {profile?.bio && (
              <p className="mt-2 max-w-xl text-sm leading-relaxed">{profile.bio}</p>
            )}
            {(profile?.created_at || profile?.twitch_created_at) && (
              <p className="mt-2 text-xs text-muted">
                {profile?.created_at
                  ? `${t("memberSince")}: ${new Date(profile.created_at).toLocaleDateString(locale, { dateStyle: "medium" })}`
                  : ""}
                {profile?.created_at && profile?.twitch_created_at ? " · " : ""}
                {profile?.twitch_created_at
                  ? `${t("twitchSince")}: ${new Date(profile.twitch_created_at).toLocaleDateString(locale, { dateStyle: "medium" })}`
                  : ""}
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {isOwn ? (
              <Link href="/account" className="btn btn-secondary btn-sm">
                {t("editProfile")}
              </Link>
            ) : null}
            <a
              href={`https://www.twitch.tv/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              {t("viewOnTwitch")} ↗
            </a>
            <ShareButtons
              path={`/${locale}/profile/${handle}`}
              title={t("shareTitle", { name: displayName })}
            />
            {profile && !isOwn && <CoinRainButton profileId={profile.id} />}
          </div>
        </div>
        </ProfileTilt>
      </section>

      {profile && greetingBanner && (
        <div className="pf-greeting">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden focusable="false" style={{ color: "var(--pf-accent, var(--accent))" }}>
            <path d="M12 3l1.9 5.6L19.5 10l-4.4 3.4L16.5 19 12 16l-4.5 3 1.4-5.6L4.5 10l5.6-1.4z" strokeLinejoin="round" />
          </svg>
          <span>{t("greeting", { name: displayName })}</span>
        </div>
      )}

      {profile && achievementTicker && unlockedAchievements.length > 1 && (
        <div className="pf-ticker" aria-label={t("achievements")}>
          <div className="pf-ticker-track">
            {[0, 1].map((pass) => (
              <div key={pass} className="flex shrink-0 items-center gap-4" aria-hidden={pass === 1}>
                {unlockedAchievements.slice(0, 10).map((entry) => {
                  const achievement = ACH_BY_ID.get(entry.achievement_id);
                  if (!achievement) return null;
                  return (
                    <span key={`${pass}-${entry.achievement_id}`} className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                      <AchievementBadge title={achievement.title} category={achievement.category} size={22} />
                      <span className="whitespace-nowrap">{achievement.title}</span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats. The first three tiles describe the inventory: without it the
          counts are zero, which would publish a false "0 owned / N missing". */}
      {profile && showStats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {inventoryVisible && (
            <>
              <div className="card stat-tile">
                <dd className="stat-value">{ownedBadges.length}</dd>
                <dt className="stat-label">{t("owned")}</dt>
              </div>
              <div className="card stat-tile">
                <dd className="stat-value">{Math.max(0, totalCatalog - ownedBadges.length)}</dd>
                <dt className="stat-label">{t("missing")}</dt>
              </div>
              <div className="card stat-tile">
                <dd className="stat-value">{percent}%</dd>
                <dt className="stat-label">{t("completion")}</dt>
              </div>
            </>
          )}
          <div className="card stat-tile">
            <dd className="stat-value">{showcaseBadges.length}</dd>
            <dt className="stat-label">{t("showcase")}</dt>
          </div>
          {profile.potat_level !== null && (
            <div className="card stat-tile">
              <dd className="stat-value">{profile.potat_level}</dd>
              <dt className="stat-label">{t("communityLevel")}</dt>
            </div>
          )}
          {profile.potatoes !== null && (
            <div className="card stat-tile">
              <dd className="stat-value">
                {new Intl.NumberFormat(locale).format(profile.potatoes)}
              </dd>
              <dt className="stat-label">{t("communityPoints")}</dt>
            </div>
          )}
          {/* Game-activity streak (0047): never publish zeros for a member
              who has not played yet. Best streak survives lost days. */}
          {progress && (progress.game_streak > 0 || progress.best_game_streak > 0) && (
            <>
              <div className="card stat-tile">
                <dd className="stat-value">{progress.game_streak}</dd>
                <dt className="stat-label">{t("gameStreak")}</dt>
              </div>
              <div className="card stat-tile">
                <dd className="stat-value">{progress.best_game_streak}</dd>
                <dt className="stat-label">{t("gameStreakBest")}</dt>
              </div>
            </>
          )}
        </section>
      )}

      {/* Arcade statistics (0073): the won/lost/wagered trio (green/red by
          sign), plus rounds, win rate, best round, jackpots, wheel, heists
          and streaks — every tile individually hideable from the customizer
          (default visible); zeros for never-touched activities stay hidden. */}
      {profile && progress && arcadeActive && (
        <section aria-labelledby="arcade-stats-head" className="space-y-3">
          <h2
            id="arcade-stats-head"
            className="text-sm font-bold uppercase tracking-[0.08em] text-muted"
          >
            {t("arcadeStats")}
          </h2>
          {monthActive && showMonthSummary && (
            <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 px-4 py-2.5 text-sm">
              <p>
                {t(
                  monthNet > 0
                    ? "monthSummaryUp"
                    : monthNet < 0
                      ? "monthSummaryDown"
                      : "monthSummaryFlat",
                  {
                    who: isOwn
                      ? t("monthWhoYou")
                      : t("monthWhoName", { name: profile.username }),
                    wagered: fmtNum(monthWagered),
                    rounds: fmtNum(monthRounds.length),
                    wins: fmtNum(monthWins),
                    net: fmtNum(Math.abs(monthNet)),
                  },
                )}{" "}
                {monthCompare &&
                  t(
                    monthCompare.kind === "up"
                      ? "monthCompareUp"
                      : monthCompare.kind === "down"
                        ? "monthCompareDown"
                        : "monthCompareFlat",
                    { pct: fmtNum(monthCompare.pct) },
                  )}
                {monthShare !== null &&
                  " " +
                    t("monthShare", {
                      share: (monthShare * 100).toFixed(1),
                    })}
              </p>
              {monthBest && (
                <p className="mt-1 text-xs text-muted">
                  {t("monthBestHit", {
                    n: monthBest.payout - monthBest.bet,
                    game: tg(`${monthBest.game}Title`),
                    date: new Intl.DateTimeFormat(locale, {
                      day: "2-digit",
                      month: "short",
                    }).format(new Date(monthBest.created_at)),
                  })}
                </p>
              )}
              {bestWeekNet > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {t("monthBestWeek", { n: fmtNum(bestWeekNet) })}
                </p>
              )}
              {monthRank > 0 && (
                <span className="chip pointer-events-none mt-1 w-fit text-accent">
                  {t("monthRankChip", { rank: monthRank })}
                </span>
              )}
              {/* Share card (round 14): the member's month as an OG image —
                  previewed here; the ?month=1 link swaps the profile's
                  og:image so the shared link unfurls THIS card. */}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/og/month?u=${encodeURIComponent(profile.username)}&locale=${locale}`}
                  alt={t("monthShareTitle", { name: profile.username })}
                  width={288}
                  height={151}
                  loading="lazy"
                  className="w-48 rounded-[var(--radius-input)] border border-line"
                />
                <ShareButtons
                  path={`/${locale}/profile/${profile.username}?month=1`}
                  title={t("monthShareTitle", { name: profile.username })}
                />
              </div>
              {crashBest && crashBest.mult >= 25 && (
                /* The 25x+ Badge Rocket share card (0081): previewed here;
                   the ?crash=1 link swaps the profile's og:image so the
                   shared link unfurls THIS card — the month-card doctrine. */
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/og/crash?u=${encodeURIComponent(profile.username)}`}
                    alt={t("crashShareTitle", { name: profile.username })}
                    width={288}
                    height={151}
                    loading="lazy"
                    className="w-48 rounded-[var(--radius-input)] border border-line"
                  />
                  <div className="flex min-w-0 flex-col items-start gap-1.5">
                    <span className="text-xs font-bold text-warning" dir="ltr">
                      {t("crashBestLine", {
                        mult: crashBest.mult.toFixed(2),
                        n: crashBest.payout,
                      })}
                    </span>
                    <ShareButtons
                      path={`/${locale}/profile/${profile.username}?crash=1`}
                      title={t("crashShareTitle", { name: profile.username })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {showStatWagered && played > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">
                  {fmtNum(wagered)} <Coin size={12} />
                </dd>
                {trendChip(weekWagered)}
                {rankChip("wagered")}
                <dt className="stat-label">{t("statWagered")}</dt>
                {miniStrip("wagered")}
              </div>
            )}
            {showStatWon && played > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value text-success">
                  +{fmtNum(wonTotal)} <Coin size={12} />
                </dd>
                {trendChip(weekWon)}
                {rankChip("won")}
                <dt className="stat-label">{t("statWon")}</dt>
                {miniStrip("won")}
              </div>
            )}
            {showStatLost && played > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value text-danger">
                  −{fmtNum(lostTotal)} <Coin size={12} />
                </dd>
                {weekLost > 0 ? (
                  <span dir="ltr" className="stat-trend text-danger">
                    +{fmtNum(weekLost)} {t("statThisWeek")}
                  </span>
                ) : null}
                <dt className="stat-label">{t("statLost")}</dt>
                {miniStrip("lost")}
              </div>
            )}
            {showStatNet && played > 0 && (
              <div className="card stat-tile">
                <dd
                  dir="ltr"
                  className={netTotal >= 0 ? "stat-value text-success" : "stat-value text-danger"}
                >
                  {netTotal >= 0 ? "+" : "−"}{fmtNum(Math.abs(netTotal))} <Coin size={12} />
                </dd>
                {weekNet !== 0 ? (
                  <span
                    dir="ltr"
                    className={weekNet > 0 ? "stat-trend text-success" : "stat-trend text-danger"}
                  >
                    {weekNet > 0 ? "+" : "−"}{fmtNum(Math.abs(weekNet))} {t("statThisWeek")}
                  </span>
                ) : null}
                <dt className="stat-label">{t("statNet")}</dt>
              </div>
            )}
            {showStatRounds && played > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(played)}</dd>
                {trendChip(weekRoundsCount)}
                {rankChip("rounds")}
                <dt className="stat-label">{t("statRounds")}</dt>
                {miniStrip("rounds")}
              </div>
            )}
            {showStatWins && played > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(progress.games_won)}</dd>
                {trendChip(weekWinsCount)}
                <dt className="stat-label">{t("statWins")}</dt>
              </div>
            )}
            {showStatWinRate && played > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">
                  {Math.round((progress.games_won / played) * 100)}%
                </dd>
                <dt className="stat-label">{t("statWinRate")}</dt>
              </div>
            )}
            {showStatBestRound && bestNet > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value text-success">
                  +{fmtNum(bestNet)} <Coin size={12} />
                </dd>
                <dt className="stat-label">{t("statBestRound")}</dt>
              </div>
            )}
            {showStatJackpots && jackpotWins.length > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value text-warning">
                  {jackpotWins.length}
                </dd>
                {trendChip(weekJackpotWins)}
                <dt className="stat-label">{t("statJackpots")}</dt>
              </div>
            )}
            {showStatWheel && progress.wheel_spins > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(progress.wheel_spins)}</dd>
                <dt className="stat-label">{t("statWheel")}</dt>
              </div>
            )}
            {showStatSteals && stealAttempts > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(progress.steals_successful)}</dd>
                <dt className="stat-label">{t("statSteals")}</dt>
              </div>
            )}
            {showStatRobbed && progress.times_robbed > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(progress.times_robbed)}</dd>
                <dt className="stat-label">{t("statRobbed")}</dt>
              </div>
            )}
            {showStatLoginStreak && progress.best_login_streak > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(progress.best_login_streak)}</dd>
                <dt className="stat-label">{t("statLoginStreak")}</dt>
              </div>
            )}
            {showStatAchievements && achievementCount > 0 && (
              <div className="card stat-tile">
                <dd dir="ltr" className="stat-value">{fmtNum(achievementCount)}</dd>
                <dt className="stat-label">{t("statAchievements")}</dt>
              </div>
            )}
          </div>
          {/* 30-day activity heatmap (GitHub-style), clickable: intensity =
              rounds per UTC day; picking a day expands its rounds below
              (client island — see ActivityHeatmap for the boundary notes).
              Rides the showMonthSummary flag: it is the month surface's
              visual half. */}
          {showMonthSummary && monthActive && (
            <ActivityHeatmap cells={heatCells} days={heatDays} />
          )}
        </section>
      )}
      {/* Coin flow — the shared card, also rendered on /stats for the owner. */}
      {profile && progress && showCoins && (
        <CoinFlowCard rows={coinRows} id="profile-coin-flow" />
      )}

      {/* Best rounds — owner-only tile row from the per-player view (0055). */}
      {isOwn && bestRows.length > 0 && (
        <BestRoundsCard
          rows={bestRows}
          history={recordHistory}
          id="profile-best-rounds"
        />
      )}

      {/* Item shelf, in the badge-detail gallery style: one gal-stage card per
          owned item kind. Visibility rides the same compound flag the badge
          inventory uses — hiding your inventory hides the shelf too, while
          the owner always sees their own stock. A member who burned every
          freeze keeps the shelf when rescue history exists (the ×0 chip is
          real usage, not a never-played zero — that member has no item row
          at all and stays hidden). With one or zero left the stage runs the
          cold snow state. */}
      {profile &&
        inventoryVisible &&
        itemFreezes !== null &&
        (itemFreezes > 0 || rescueDates.length > 0) && (
        <section
          className={`gal-stage card flex flex-col items-center gap-5 p-6 sm:flex-row sm:p-8${
            itemFreezes <= 1 ? " item-shelf-cold" : ""
          }`}
          style={{ ["--tier-color" as string]: ITEM_COLORS.streak_freeze }}
          aria-labelledby="profile-items"
        >
          {itemFreezes <= 1 && (
            <span className="item-snow-field" aria-hidden="true">
              {SNOW_DOTS.map((dot) => (
                <span
                  key={dot.left}
                  className="item-snow"
                  style={{
                    left: dot.left,
                    width: dot.size,
                    height: dot.size,
                    animationDelay: dot.delay,
                    animationDuration: dot.duration,
                  }}
                />
              ))}
            </span>
          )}
          <figure className="gal-pedestal shrink-0">
            <span className="gal-halo" aria-hidden="true" />
            <div className="hero-emblem">
              <span className="hero-emblem-halo" aria-hidden="true" />
              <ItemIcon id="streak_freeze" />
            </div>
            <div className="gal-plinth" aria-hidden="true" />
            <span className="gal-plinth-shadow" aria-hidden="true" />
          </figure>
          <figcaption className="sr-only">{t("itemShelf")}</figcaption>
          <div
            className="gal-placard card min-w-0 flex-1 p-5 text-center sm:text-start"
            id="profile-items"
          >
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="chip pointer-events-none font-bold text-accent">
                ×{itemFreezes}
              </span>
              <span
                className="chip pointer-events-none"
                title={t("freezeExplain")}
                aria-label={t("freezeExplain")}
                tabIndex={0}
              >
                {t("freezeName")}
              </span>
              {/* Ice Guardian progress — the 5 mirrors the s_ice_guardian
                  threshold in achievements.ts; shown once rescue history exists. */}
              {guardianRescues > 0 && (
                <span className="chip pointer-events-none font-bold">
                  {t("guardianProgress", { n: guardianRescues })}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-lg font-extrabold tracking-tight">
              {t("itemShelf")}
            </h2>
            <p className="mt-1 text-sm text-muted">{t("freezeExplain")}</p>
            {rescueDates.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                {t("freezeHistory", {
                  dates: rescueDates
                    .map((d) =>
                      new Date(d).toLocaleDateString(locale, { dateStyle: "medium" }),
                    )
                    .join(" · "),
                })}
              </p>
            )}
            {/* The shop is self-service: only the viewer's own shelf may sell
                into their own account (the shelf itself renders for all). */}
            {isOwn &&
              (itemFreezes >= FREEZE_MAX ? (
                <p className="mt-2 text-xs text-muted">
                  {t("buyCapped", { max: FREEZE_MAX })}
                </p>
              ) : (
                <div className="mt-2">
                  <BuyFreezeButton
                    price={economy.freezePrice}
                    canAfford={(progress?.coins ?? 0) >= economy.freezePrice}
                    max={FREEZE_MAX}
                  />
                </div>
              ))}
          </div>
        </section>
      )}

      {profile &&
        (profile.potat_first_seen ||
          (profile.potat_connections ?? []).length > 0) && (
        <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-xs text-muted">
          {profile.potat_first_seen && (
            <span>
              {t("communitySince")}:{" "}
              {new Date(profile.potat_first_seen).toLocaleDateString(locale, {
                dateStyle: "medium",
              })}
            </span>
          )}
          {(profile.potat_connections ?? []).length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {t("connections")}:
              {(profile.potat_connections ?? []).map((conn) => (
                <span key={conn.platform} className="chip pointer-events-none text-[0.5625rem]">
                  {conn.platform}
                </span>
              ))}
            </span>
          )}
        </section>
      )}

      {/* Non-member claim hint */}
      {!profile && (
        <section className="card flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted">{t("claim")}</p>
          <TwitchLoginButton />
        </section>
      )}

      {/* Achievement hero showcase */}
      {profile && unlockedAchievements.length > 0 && (
        <section aria-labelledby="ach-hero" className="card achievement-hero p-6">
          <div className="section-title">
            <h2 id="ach-hero">{t("achievements")}</h2>
            <span className="chip pointer-events-none">
              {unlockedAchievements.length} · {progress?.achievements_points ?? 0} {t("achievementPoints")}
            </span>
          </div>
          <div className="flex flex-wrap gap-4">
            {unlockedAchievements.slice(0, 12).map((entry) => {
              const achievement = ACH_BY_ID.get(entry.achievement_id);
              if (!achievement) return null;
              return (
                <div key={entry.achievement_id} className="flex w-20 flex-col items-center gap-1.5 text-center">
                  <AchievementBadge title={achievement.title} category={achievement.category} size={52} />
                  <p className="line-clamp-2 text-[0.625rem] font-bold leading-tight">{achievement.title}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Latest visitors + view count */}
      {profile && showVisitors && (
        <section className={`card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 ${visitorMarquee ? "pf-marquee" : ""}`}>
          <span className="text-xs text-muted">
            <span className="font-black text-foreground tabular-nums">{profile.view_count ?? 0}</span> {t("views")}
          </span>
          {latestVisitors.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted">{t("latestVisitors")}:</span>
              <span className={visitorMarquee ? "pf-marquee-track" : "flex items-center gap-1.5"}>
              {latestVisitors.slice(0, 8).map((visitor, index) =>
                visitor.username ? (
                  <Link
                    key={`${visitor.username}-${index}`}
                    href={`/profile/${visitor.username}`}
                    title={visitor.username}
                    className="transition-transform hover:scale-110"
                  >
                    {visitor.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={visitor.avatar_url} alt={visitor.username} width={24} height={24} className="rounded-full" />
                    ) : (
                      <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-[0.5625rem] font-bold text-accent">
                        {visitor.username.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </Link>
                ) : null,
              )}
              </span>
            </span>
          )}
        </section>
      )}

      {/* Steal panel on other profiles */}
      {profile && !isOwn && (
        <StealPanel
          victim={profile.username}
          price={Math.max(0, profile.steal_price ?? economy.stealPrice)}
          maxAmount={Math.max(10, profile.steal_max ?? economy.stealMax)}
          enabled={profile.steal_enabled !== false}
        />
      )}

      {/* Showcase */}
      {profile && (
        <section aria-labelledby="showcase">
          <div className="section-title">
            <h2 id="showcase">{t("showcase")}</h2>
          </div>
          {showcaseBadges.length > 0 && showcaseLayout === "carousel" ? (
            // A seamless loop needs the content twice: each tile animates by
            // exactly one content-width, so the duplicate hides the jump.
            <div className="pf-ticker">
              <div className="pf-ticker-track">
                {[0, 1].map((pass) => (
                  <div key={pass} className="flex shrink-0 gap-3" aria-hidden={pass === 1}>
                    {showcaseBadges.map((badge) => (
                      <Link
                        key={`${pass}-${badge.id}`}
                        href={`/badges/${badge.slug}`}
                        className="badge-tile card-interactive w-32 shrink-0 rounded-[var(--radius-card)]"
                      >
                        <BadgeImage badge={badge} size={48} alt="" />
                        <p className="line-clamp-2 text-[0.6875rem] font-semibold leading-tight">
                          {badge.title}
                        </p>
                        <RarityChip tier={badge.rarity_tier} compact />
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : showcaseBadges.length > 0 ? (
            <div
              className={[
                "card grid grid-cols-3 gap-3 p-5 sm:grid-cols-6",
                showcaseLayout === "row" ? "pf-showcase-row" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {showcaseBadges.map((badge) => (
                <Link
                  key={badge.id}
                  href={`/badges/${badge.slug}`}
                  className="badge-tile card-interactive rounded-[var(--radius-card)]"
                >
                  <BadgeImage badge={badge} size={48} alt="" />
                  <p className="line-clamp-2 text-[0.6875rem] font-semibold leading-tight">
                    {badge.title}
                  </p>
                  <RarityChip tier={badge.rarity_tier} compact />
                </Link>
              ))}
            </div>
          ) : (
            <div className="card p-6 text-center text-sm text-muted">
              {t("showcaseEmpty")}
            </div>
          )}
        </section>
      )}

      {/* Owned badges. The section renders for everyone so the "inventory hidden"
          message stays reachable; only the count in the heading depends on
          visibility, because it would otherwise read "Owned (0)" for a hidden
          inventory (the rows are never fetched then). */}
      {profile && (
        <section aria-labelledby="profile-owned">
          <div className="section-title">
            <h2 id="profile-owned">
              {inventoryVisible
                ? `${t("owned")} (${ownedBadges.length})`
                : t("owned")}
            </h2>
          </div>
          {inventoryVisible ? (
            ownedBadges.length > 0 ? (
              <BadgeGrid badges={ownedBadges} showCountdown={false} />
            ) : (
              <div className="card p-10 text-center text-sm text-muted">
                {ti("emptyOwned")}
              </div>
            )
          ) : (
            <div className="card p-10 text-center text-sm text-muted">
              {t("inventoryHidden")}
            </div>
          )}
        </section>
      )}

      {/* Live (non-member) badge list */}
      {!profile && liveBadges.length > 0 && (
        <section aria-labelledby="live-owned">
          <div className="section-title">
            <h2 id="live-owned">
              {t("owned")} ({liveBadges.length})
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {liveBadges.slice(0, 48).map((badge) => (
              <Link
                key={`${badge.setId}:${badge.version}`}
                href={`/badges/${badge.slug}`}
                className="card card-interactive badge-tile"
              >
                {badge.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={badge.image} alt={badge.title} width={48} height={48} loading="lazy" />
                ) : null}
                <p className="line-clamp-2 text-[0.6875rem] font-semibold leading-tight">
                  {badge.title}
                </p>
                {badge.tier ? <RarityChip tier={badge.tier} compact /> : null}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
