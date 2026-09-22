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
import AchievementBadge from "@/components/AchievementBadge";
import CoinRainButton from "@/components/CoinRainButton";
import Coin from "@/components/Coin";
import StealPanel from "@/components/StealPanel";
import { readProgress } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";
import { ACH_BY_ID } from "@/lib/gamification/achievements";
import { recordProfileVisit } from "@/lib/gamification/visits";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitorIpHash } from "@/lib/gamification/session";
import { localeAlternates } from "@/lib/seo";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ locale: string; username: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, username } = await params;
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
          url: `/api/og/profile?u=${encodeURIComponent(username)}&locale=${locale}`,
        },
      ],
    },
  };
}

export default async function ProfilePage({ params }: PageProps) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const ti = await getTranslations("inventory");

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
    const [ipHash] = await Promise.all([visitorIpHash()]);
    // Your own view of someone else's profile must not be counted, and the
    // visitor list is only shown to the profile owner: `profile_visits` is
    // owner-only under RLS, and reading it through the admin client for every
    // visitor published who had looked at whom.
    if (!isOwn) {
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

  // The customizer stores its settings in `profiles.customization`, and until now
  // the public profile applied NONE of them — a member could hide their coins,
  // their level or their visitors and nothing changed. The functional toggles and
  // the two value-only cosmetics are honoured here; the rest are effect and
  // animation settings that need their own CSS (listed in FIXES.md).
  const customization = (profile?.customization ?? {}) as Record<string, unknown>;
  const flag = (key: string, fallback: boolean) =>
    typeof customization[key] === "boolean"
      ? (customization[key] as boolean)
      : fallback;
  const text = (key: string, fallback: string) =>
    typeof customization[key] === "string" && (customization[key] as string).trim()
      ? (customization[key] as string)
      : fallback;
  const number = (key: string, fallback: number) =>
    typeof customization[key] === "number" &&
    Number.isFinite(customization[key] as number)
      ? (customization[key] as number)
      : fallback;

  const showLevel = flag("showLevel", true);
  const showCoins = flag("showCoins", true);
  const showStats = flag("showStats", true);
  const showVisitors = flag("showVisitors", true);
  const showInventory = flag("showInventory", true);
  // Only a comma-separated list of hex colours is accepted, so the value cannot
  // smuggle arbitrary CSS into a style attribute.
  const nameGradientRaw = text("nameGradient", "");
  const nameGradient = /^#[0-9a-fA-F]{3,8}(,\s*#[0-9a-fA-F]{3,8})+$/.test(
    nameGradientRaw,
  )
    ? nameGradientRaw
    : "";
  const bannerOverlay = Math.min(90, Math.max(0, number("bannerOverlay", 0)));

  // Member data: showcase + inventory.
  let showcaseBadges: BadgeRow[] = [];
  let ownedBadges: BadgeRow[] = [];
  let totalCatalog = 0;
  let inventoryVisible = false;
  if (profile) {
    inventoryVisible = (profile.inventory_public || isOwn) && showInventory;
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
  if (profile) {
    const admin = createAdminClient();
    const [progressRow, achievementRes] = await Promise.all([
      readProgress(profile.id).catch(() => null),
      admin
        .from("user_achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", profile.id)
        .order("unlocked_at", { ascending: false })
        .limit(25),
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
  }

  return (
    <div className="space-y-8">
      {/* Banner + identity */}
      <section className="card overflow-hidden">
        <div
          className="h-28 bg-accent-soft sm:h-36"
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
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <div className="-mt-10 shrink-0 rounded-full border-4 border-surface bg-surface">
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
              {level && showLevel && <LevelBadge level={level.level} size={64} />}
              <div className="min-w-0">
                <h1
                  className="truncate text-2xl font-extrabold tracking-tight"
                  style={
                    nameGradient
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
                <p className="text-sm text-muted">@{handle}</p>
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
              <Link href="/account" className="btn btn-secondary text-xs">
                {t("editProfile")}
              </Link>
            ) : null}
            <a
              href={`https://www.twitch.tv/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost text-xs"
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
      </section>

      {/* Stats */}
      {profile && showStats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <section className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <span className="text-xs text-muted">
            <span className="font-black text-foreground tabular-nums">{profile.view_count ?? 0}</span> {t("views")}
          </span>
          {latestVisitors.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted">{t("latestVisitors")}:</span>
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
          )}
        </section>
      )}

      {/* Steal panel on other profiles */}
      {profile && !isOwn && (
        <StealPanel
          victim={profile.username}
          price={profile.steal_price ?? 100}
          maxAmount={profile.steal_max ?? 250}
          enabled={profile.steal_enabled !== false}
        />
      )}

      {/* Showcase */}
      {profile && (
        <section aria-labelledby="showcase">
          <div className="section-title">
            <h2 id="showcase">{t("showcase")}</h2>
          </div>
          {showcaseBadges.length > 0 ? (
            <div className="card grid grid-cols-3 gap-3 p-5 sm:grid-cols-6">
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

      {/* Owned badges */}
      {profile && (
        <section aria-labelledby="profile-owned">
          <div className="section-title">
            <h2 id="profile-owned">
              {t("owned")} ({ownedBadges.length})
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
