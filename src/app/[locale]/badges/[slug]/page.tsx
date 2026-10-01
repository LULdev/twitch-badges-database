import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getBadgeBySlug,
  getBadgeEvents,
  getBadgeMomentum,
  getBadgeMemberCount,
  getBadgeStatsHistory,
  getPostBySlug,
  listBadges,
  type BadgeEventRow,
} from "@/lib/queries";
import { BadgeImage } from "@/components/badges/BadgeImage";
import RarityChip from "@/components/badges/RarityChip";
import Countdown from "@/components/badges/Countdown";
import ClaimBar from "@/components/badges/ClaimBar";
import MomentumReadout from "@/components/badges/MomentumReadout";
import TiltPedestal from "@/components/badges/TiltPedestal";
import RarityRadar from "@/components/badges/RarityRadar";
import MarketMap from "@/components/badges/MarketMap";
import { StatusChip } from "@/components/badges/BadgeCard";
import { jsonLdScript } from "@/lib/jsonld";
import { buildBadgeFaq } from "@/lib/badges/faq";
import BadgeGrid from "@/components/badges/BadgeGrid";
import OwnersChart from "@/components/charts/OwnersChart";
import ShareButtons from "@/components/ShareButtons";
import LiveRefresher from "@/components/LiveRefresher";
import BadgeReactions from "@/components/badges/BadgeReactions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitorIpHash } from "@/lib/gamification/session";
import { localeAlternates, siteUrl } from "@/lib/seo";
import { fetchBadgeLiveStats } from "@/lib/twitch/potat";
import {
  computeRarityComponents,
  RARITY_COLORS,
  RARITY_WEIGHTS,
  type RarityComponentKey,
} from "@/lib/rarity";
import { isTicketBadge } from "@/lib/twitch/types";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const badge = await getBadgeBySlug(slug).catch(() => null);
  if (!badge) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("badgeTitle", { title: badge.title });
  const description = t("badgeDescription", {
    title: badge.title,
    setId: badge.set_id,
  });
  const image =
    badge.image_url_4x ?? badge.image_url_2x ?? badge.image_url_1x ?? undefined;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/badges/${badge.slug}`,
      languages: localeAlternates(`/badges/${badge.slug}`),
    },
    // A page-level `openGraph` REPLACES the layout's rather than merging with it,
    // so the layout's `type`/`siteName` never reached the head — the live page
    // emitted only og:title/og:description/og:image, i.e. no og:type (which the
    // Open Graph protocol requires) and no og:url. `url` is resolved against the
    // layout's metadataBase. "website" is the correct generic type here: "article"
    // would declare a news post and imply article:* properties a catalog entry
    // does not have.
    openGraph: {
      type: "website",
      siteName: t("siteTitle"),
      url: `/${locale}/badges/${badge.slug}`,
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
    // Next's Metadata API does NOT fall back to openGraph.images for Twitter —
    // the "summary" card without images shared imageless on X.
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The six TBRI axes in render order. */
const COMPONENT_KEYS: RarityComponentKey[] = [
  "scarcity",
  "wear",
  "obtainability",
  "age",
  "momentum",
  "brevity",
];

const COMPONENT_COLOR: Record<RarityComponentKey, string> = {
  scarcity: "var(--accent)",
  wear: "var(--success)",
  obtainability: "var(--warning)",
  age: "var(--info)",
  momentum: "var(--danger)",
  brevity: "var(--rank-gold)",
};

export default async function BadgeDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [t, tFaq, tcd, tc] = await Promise.all([
    getTranslations("badges"),
    getTranslations("badgeFaq"),
    getTranslations("countdown"),
    getTranslations("common"),
  ]);

  const percent = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const int = new Intl.NumberFormat(locale);

  // Deliberately no .catch here: getBadgeBySlug returns null only for a missing
  // slug, so a real query error now surfaces instead of becoming a 404.
  const badge = await getBadgeBySlug(slug);
  if (!badge) notFound();

  const [history, related, live, events, momentum, memberCount, dropPost] = await Promise.all([
    getBadgeStatsHistory(badge.id).catch(() => []),
    badge.category
      // 25 rows feeds the Market Map with ~24 category peers; the related grid
      // still slices 6 from the same deterministic order (id tiebreak), so
      // nothing changes for it. (perPage clamps at 12–96 anyway — 7 was 12.)
      ? listBadges({ category: badge.category, perPage: 25 }).catch(() => null)
      : Promise.resolve(null),
    fetchBadgeLiveStats(badge.set_id).catch(() => null),
    getBadgeEvents(badge.id).catch(() => [] as BadgeEventRow[]),
    // A missing row is "no momentum data" (windowless badges are outside the
    // view), not an error — the momentum component then takes its neutral 0.5.
    getBadgeMomentum(badge.id).catch(() => null),
    getBadgeMemberCount(badge.id).catch(() => 0),
    getPostBySlug(`drop-${badge.slug}`).catch(() => null),
  ]);

  const chartData = history.map((point) => ({
    label: new Date(point.polled_at).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    }),
    owners: point.owner_count,
    active: point.active_count,
  }));

  const relatedBadges = (related?.items ?? []).filter((b) => b.id !== badge.id).slice(0, 6);

  // Category peers for the Market Map: same query, wider window than the grid.
  // share stays on the 0..1 scale the map's dot radii expect.
  const mapPeers = (related?.items ?? [])
    .filter((b) => b.id !== badge.id)
    .map((b) => ({
      slug: b.slug,
      title: b.title,
      owners: b.owner_count,
      score: b.rarity_score,
      share: b.percentage === null ? null : Number(b.percentage) / 100,
    }));

  /**
   * Ownership figures, one source per metric.
   *
   * `badge.owner_count` is the only source for the headline: it is potat's
   * LIFETIME owner total. The live lookup returns potat's CURRENT-wearer count
   * — the same metric as `active_count`, not the same as the owner total — so
   * falling back to it for the headline would publish a figure that is smaller
   * by orders of magnitude and label it "people own this badge". When the
   * stored poll has not run yet, the honest answer is "no data", and the FAQ's
   * owners answer already words the live-only case correctly on its own.
   */
  const totalOwners = badge.owner_count;
  const share =
    badge.percentage !== null
      ? Number(badge.percentage)
      : live?.percentage !== null && live?.percentage !== undefined
        ? Number(live.percentage)
        : null;
  const holding = live?.userCount ?? badge.active_count ?? null;

  // Hero GIF reactions. Counts go through the anon server client (migration
  // 0044 granted badge_id, reaction, created_at — never ip_hash); resolving
  // which are the visitor's own needs the hash, so that one lookup uses the
  // service-role client, mirroring the blog page's split. Best-effort: an
  // un-migrated DB renders zero counts instead of crashing the page.
  const reactionCounts: Record<string, number> = {};
  let myReactions: string[] = [];
  try {
    const ipHash = await visitorIpHash();
    const anon = await createClient();
    const { data: rows } = await anon
      .from("badge_reactions")
      .select("reaction")
      .eq("badge_id", badge.id);
    for (const row of (rows ?? []) as Array<{ reaction: string }>) {
      reactionCounts[row.reaction] = (reactionCounts[row.reaction] ?? 0) + 1;
    }
    const { data: mine } = await createAdminClient()
      .from("badge_reactions")
      .select("reaction")
      .eq("badge_id", badge.id)
      .eq("ip_hash", ipHash);
    myReactions = [
      ...new Set((mine ?? []).map((row) => (row as { reaction: string }).reaction)),
    ];
  } catch {
    // counters are best-effort
  }

  const faq = buildBadgeFaq(badge, {
    locale,
    t: tFaq,
    liveUserCount: live?.userCount ?? null,
    livePercentage: live?.percentage ?? null,
  });

  /** The owner's trajectory, in words (see OwnersChart for the curve). */
  const trend = (() => {
    const points = history.filter(
      (p) => p.owner_count !== null && Number.isFinite(p.owner_count),
    );
    if (points.length < 2) return null;
    const first = points[0].owner_count as number;
    const last = points[points.length - 1].owner_count as number;
    if (first === 0) return null;
    const changePct = ((last - first) / first) * 100;
    return {
      changePct,
      direction:
        Math.abs(changePct) < 0.5
          ? ("flat" as const)
          : changePct > 0
            ? ("growing" as const)
            : ("shrinking" as const),
      samples: points.length,
      windowDays: Math.max(
        1,
        Math.round(
          (new Date(points[points.length - 1].polled_at).getTime() -
            new Date(points[0].polled_at).getTime()) /
            86_400_000,
        ),
      ),
    };
  })();

  /**
   * Where this record came from. `source` is the sync engine that last wrote the
   * row, so it is the honest answer to "why should I trust these numbers".
   */
  const SOURCE_KEYS: Record<string, string> = {
    helix: "sourceHelix",
    badgebase: "sourceBadgebase",
    custom: "sourceCustom",
    sync: "sourceSync",
  };
  const sourceLabel = t(SOURCE_KEYS[badge.source] ?? "sourceOther");

  // The six TBRI components recomputed live from the same inputs the potat
  // sync feeds the engine (stored counts + the momentum view). The headline
  // score stays the STORED badge.rarity_score — the bars explain the current
  // drivers, they never overwrite the shipped number.
  const rarityNow = computeRarityComponents({
    totalOwners: badge.owner_count,
    activeUsers: badge.active_count,
    status: badge.status,
    startDate: badge.start_date,
    endDate: badge.end_date,
    firstSeenAt: badge.first_seen_at,
    growth24h: momentum?.growth24h ?? null,
    requiresTicket: isTicketBadge(badge.set_id, badge.how_to_earn, badge.description),
  });
  const tierColor = RARITY_COLORS[badge.rarity_tier];
  const rarityComponents = COMPONENT_KEYS.map((key) => ({
    key,
    label: t(`tbri${key[0].toUpperCase()}${key.slice(1)}`),
    weight: RARITY_WEIGHTS[key],
    value: rarityNow[key],
    color: COMPONENT_COLOR[key],
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: badge.title,
    description: badge.description ?? badge.how_to_earn ?? badge.title,
    image: badge.image_url_4x ?? badge.image_url_2x ?? badge.image_url_1x ?? undefined,
    category: badge.category,
    // A Product without `offers` is rejected by Google's rich-results test
    // ("Missing field offers"), which forfeits eligibility for every badge page.
    // Badges are documented here, not sold, so the offer states the real price to
    // a visitor: nothing.
    offers: {
      "@type": "Offer",
      price: 0,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${siteUrl()}/${locale}/badges/${badge.slug}`,
    },
    ...(badge.start_date && badge.end_date
      ? { temporalCoverage: `${badge.start_date}/${badge.end_date}` }
      : {}),
  };

  /* ---------------------------------------------------------------- */
  /* Shared sections — built once, arranged by the gallery layout.     */
  /* ---------------------------------------------------------------- */

  const claimLabels = {
    elapsed: t("claimElapsed"),
    open: t("claimOpen"),
    closed: t("claimClosed"),
    upcoming: t("claimUpcoming"),
    noEnd: t("claimNoEnd"),
  };

  const chips = (
    <>
      <StatusChip status={badge.status} />
      <RarityChip tier={badge.rarity_tier} score={badge.rarity_score} />
      <span className="chip pointer-events-none">
        {badge.is_paid ? tc("paid") : tc("free")}
      </span>
      <span className="chip pointer-events-none">{badge.category}</span>
      {badge.is_confirmed_active && (
        <span className="chip chip-live pointer-events-none">{t("confirmedActive")}</span>
      )}
    </>
  );

  const actions = (
    <>
      {badge.click_url && (
        <a
          href={badge.click_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary text-xs"
        >
          {t("openOnTwitch")}
          <span className="dir-arrow" aria-hidden="true">→</span>
        </a>
      )}
      <ShareButtons
        path={`/${locale}/badges/${badge.slug}`}
        title={`${badge.title} — Twitch Badges Database`}
      />
    </>
  );

  /** The preserved countdown strip — contract documented inline. */
  const claimStrip = (badge.status === "active" || badge.status === "upcoming") &&
    (badge.end_date || badge.start_date) && (
      <div className="flex flex-col items-center gap-2 border-t border-line bg-surface-2 px-6 py-4 sm:flex-row sm:justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          {badge.status === "upcoming" && badge.start_date
            ? tcd("startsIn")
            : badge.end_date
              ? tcd("expiresIn")
              : tcd("permanent")}
        </span>
        {badge.status === "upcoming" && badge.start_date ? (
          <Countdown size="lg" target={badge.start_date} mode="starts" />
        ) : badge.end_date ? (
          <Countdown size="lg" target={badge.end_date} mode="expires" />
        ) : (
          // An ACTIVE badge with a start date and no end date has no window
          // to count down to. The strip used to render "Expires in" against
          // `end_date ?? start_date!` — i.e. a countdown to a date in the
          // PAST, beside the "Live" status chip, and the non-null assertion
          // hid the missing case from the type checker.
          <span className="text-xs font-semibold text-success">{tcd("live")}</span>
        )}
      </div>
    );

  /** Claim-window rail for the gallery hero — the ClaimBar under the placard. */
  const claimRail = (badge.start_date || badge.end_date || badge.release_date) && (
    <div className="border-t border-line bg-surface-2 px-6 py-4">
      <ClaimBar
        start={badge.start_date}
        end={badge.end_date}
        releasedAt={badge.release_date}
        locale={locale}
        labels={claimLabels}
      />
    </div>
  );

  const acquisitionSection = (
    <section className="card p-6" aria-labelledby="bd-earn">
      <h2 id="bd-earn" className="text-sm font-bold uppercase tracking-[0.08em] text-muted">
        {t("howToEarn")}
      </h2>
      <p className="mt-3 text-sm leading-relaxed">
        {badge.how_to_earn ?? badge.description ?? t("howToEarnUnknown")}
      </p>
    </section>
  );

  const momentumChip = (
    <MomentumReadout
      growth24h={momentum?.growth24h ?? null}
      locale={locale}
      labels={{ up: t("momentumUp"), down: t("momentumDown"), flat: t("momentumFlat") }}
    />
  );

  /** Rarity panel: big stored score + the six component bars, live-recomputed. */
  /** Rarity radar: the six TBRI components as an at-a-glance hexagon shape. */
  const radarCard = (
    <RarityRadar
      components={{
        scarcity: rarityNow.scarcity,
        wear: rarityNow.wear,
        obtainability: rarityNow.obtainability,
        age: rarityNow.age,
        momentum: rarityNow.momentum,
        brevity: rarityNow.brevity,
      }}
      score={badge.rarity_score}
      tierColor={tierColor}
      labels={{
        title: t("radarTitle"),
        scarcity: t("tbriScarcity"),
        wear: t("tbriWear"),
        obtainability: t("tbriObtainability"),
        age: t("tbriAge"),
        momentum: t("tbriMomentum"),
        brevity: t("tbriBrevity"),
      }}
    />
  );

  /** Market map: this badge against its category peers (owners × TBRI).
   *  Temporarily hidden per owner decision (2026-09-29) — flip the flag to
   *  bring it back at the bottom of the page; data wiring + keys stay live. */
  const SHOW_MARKET_MAP = false;
  const marketMapSection = related !== null && mapPeers.length > 0 && (
    <MarketMap
      self={{
        owners: badge.owner_count,
        score: badge.rarity_score,
        share: share === null ? null : share / 100,
      }}
      peers={mapPeers}
      selfColor={tierColor}
      labels={{
        title: t("marketMapTitle"),
        subtitle: t("marketMapSubtitle", {
          count: int.format(Math.max(0, (related?.total ?? mapPeers.length + 1) - 1)),
        }),
        x: t("marketMapX"),
        y: t("marketMapY"),
        you: t("marketMapYou"),
        quad1: t("marketMapQuad1"),
        quad2: t("marketMapQuad2"),
        quad3: t("marketMapQuad3"),
        quad4: t("marketMapQuad4"),
      }}
    />
  );

  const rarityPanel = (
    <section className="card space-y-4 p-6" aria-labelledby="bd-rarity">
      <div className="section-title">
        <h2 id="bd-rarity">{t("tbriTitle")}</h2>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-black tabular-nums" style={{ color: tierColor }}>
          {badge.rarity_score}
        </span>
        <RarityChip tier={badge.rarity_tier} score={badge.rarity_score} />
      </div>
      <div className="flex flex-wrap gap-2">{momentumChip}</div>
      <div className="space-y-2.5">
        {rarityComponents.map((component, index) => (
          <div key={component.key} className="grow-bar">
            <span className="w-28 shrink-0 truncate text-xs text-muted">{component.label}</span>
            <div className="grow-bar-track">
              <div
                className="grow-bar-fill"
                style={{
                  width: `${Math.round(component.value * 100)}%`,
                  "--bar-color": component.color,
                  "--d": `${index * 90}ms`,
                } as React.CSSProperties}
              />
            </div>
            <span className="w-14 shrink-0 text-end font-mono text-[0.6875rem] tabular-nums text-muted">
              {Math.round(component.value * 100)}%
            </span>
          </div>
        ))}
      </div>
      <p className="text-[0.6875rem] text-muted">{t("tbriApprox")}</p>
      <p className="text-xs leading-relaxed text-muted">{t("rarityFormula")}</p>
    </section>
  );

  /** Ownership: KPI trio + trend sentence + history chart. */
  const ownershipSection = (
    <section className="card p-6" aria-labelledby="bd-owners">
      <div className="section-title">
        <h2 id="bd-owners">{t("ownerTrend")}</h2>
      </div>
      <p className="-mt-4 mb-3 text-xs text-muted">{t("ownerTrendSubtitle")}</p>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 p-3">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted">
            {t("ownersHeadlineShort")}
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {totalOwners === null ? "—" : int.format(totalOwners)}
          </p>
        </div>
        <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 p-3">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted">
            {t("wearingNow")}
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {holding === null ? "—" : int.format(holding)}
          </p>
        </div>
        <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 p-3">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted">
            {t("shareOfViewers")}
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {share === null ? "—" : `${percent.format(share)}%`}
          </p>
        </div>
      </div>
      {trend && (
        <p className="mb-3 rounded-[var(--radius-input)] border border-line bg-surface-2 px-4 py-2.5 text-sm">
          {t(`trend${trend.direction[0].toUpperCase()}${trend.direction.slice(1)}`, {
            value: percent.format(Math.abs(trend.changePct)),
            count: trend.samples,
            days: trend.windowDays,
          })}
        </p>
      )}
      {chartData.length >= 2 ? (
        <OwnersChart data={chartData} />
      ) : (
        <p className="py-8 text-center text-sm text-muted">{t("noStats")}</p>
      )}
      {badge.last_polled_at && (
        <p className="mt-3 text-end font-mono text-[0.6875rem] text-muted">
          {t("ownersUpdated")}: {formatDate(badge.last_polled_at, locale)}
        </p>
      )}
    </section>
  );

  /** Provenance: record details + lifecycle events + member count + drop post. */
  const EVENT_KEYS: Partial<Record<BadgeEventRow["kind"], string>> = {
    added: "eventAdded",
    removed: "eventRemoved",
  };
  const provenanceSection = (
    <section className="card p-6" aria-labelledby="bd-record">
      <div className="section-title">
        <h2 id="bd-record">{t("recordDetails")}</h2>
      </div>
      <p className="-mt-4 mb-4 text-xs text-muted">
        {t("sourceLabel")}: {sourceLabel}
      </p>
      <dl className="space-y-3 text-sm">
        {badge.first_seen_at && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("firstDetected")}</dt>
            <dd className="text-end font-medium">{formatDate(badge.first_seen_at, locale)}</dd>
          </div>
        )}
        {badge.release_date && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("releaseDate")}</dt>
            <dd className="text-end font-medium">{formatDate(badge.release_date, locale)}</dd>
          </div>
        )}
        {badge.start_date && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("claimOpens")}</dt>
            <dd className="text-end font-medium">{formatDate(badge.start_date, locale)}</dd>
          </div>
        )}
        {badge.end_date && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("claimCloses")}</dt>
            <dd className="text-end font-medium">{formatDate(badge.end_date, locale)}</dd>
          </div>
        )}
        {badge.last_seen_at && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("lastSeen")}</dt>
            <dd className="text-end font-medium">{formatDate(badge.last_seen_at, locale)}</dd>
          </div>
        )}
        {badge.removed_at && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("withdrawn")}</dt>
            <dd className="text-end font-medium text-danger">
              {formatDate(badge.removed_at, locale)}
            </dd>
          </div>
        )}
      </dl>

      {memberCount > 0 && (
        <p className="mt-4 rounded-[var(--radius-input)] border border-line bg-surface-2 px-4 py-2.5 text-sm">
          {t("membersOwn", { count: int.format(memberCount) })}
        </p>
      )}

      {dropPost && (
        <Link
          href={`/blog/${dropPost.slug}`}
          className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
        >
          {t("readDropPost")}
          <span className="dir-arrow" aria-hidden="true">→</span>
        </Link>
      )}

      {events.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            {t("historyTitle")}
          </h3>
          <ol className="mt-3 space-y-2.5 border-s border-line ps-4">
            {events.slice(0, 10).map((event, index) => {
              const key = EVENT_KEYS[event.kind];
              if (!key) return null;
              return (
                <li key={index} className="relative text-sm">
                  <span
                    aria-hidden
                    className="absolute -start-[1.3125rem] top-1.5 size-2 rounded-full"
                    style={{
                      background: event.kind === "removed" ? "var(--danger)" : "var(--success)",
                    }}
                  />
                  <span className="text-foreground">{t(key)}</span>
                  <span className="ms-2 font-mono text-xs text-muted">
                    {formatDate(event.created_at, locale)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );

  const faqSection = faq.items.length > 0 && (
    <section className="card p-6" aria-labelledby="badge-faq">
      <div className="section-title">
        <h2 id="badge-faq">{tFaq("title", { title: badge.title })}</h2>
      </div>
      <p className="-mt-4 mb-4 text-xs text-muted">{tFaq("subtitle")}</p>
      {/* A native disclosure list: keyboard accessible and screen-reader
          correct with no client JS, which matters because these pages are
          the most-crawled surface on the site. */}
      <div className="divide-y divide-line">
        {faq.items.map((item, index) => (
          <details key={index} className="group py-3">
            <summary className="flex cursor-pointer items-start justify-between gap-4 text-sm font-semibold marker:content-none">
              <span>{item.q}</span>
              <span
                aria-hidden
                className="mt-0.5 shrink-0 text-muted transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );

  const relatedSection = relatedBadges.length > 0 && (
    <section aria-labelledby="related">
      <div className="section-title">
        <h2 id="related">{t("sameCategory", { category: badge.category })}</h2>
      </div>
      <BadgeGrid badges={relatedBadges} showCountdown={false} />
    </section>
  );

  const breadcrumb = (
    <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
      <Link href="/badges" className="hover:text-foreground">
        {tc("viewAll")}
      </Link>
      <span className="mx-1.5">/</span>
      <span className="text-foreground">{badge.title}</span>
    </nav>
  );

  const headerScripts = (
    <>
      <LiveRefresher intervalMs={120_000} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      {/* The FAQPage is rendered from the SAME `faq.items` array as the visible
          accordion below. Google invalidates a rich result when the structured
          data and the on-page text disagree, so the two must never be built
          separately. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faq.jsonLd) }}
      />
    </>
  );

  /* ---------------------------------------------------------------- */
  /* "Gallery" layout: pedestal, placard, two-column wing.             */
  /* ---------------------------------------------------------------- */
  return (
    <div className="space-y-8">
      {headerScripts}
      {breadcrumb}
      <section className="gal-stage card" style={{ ["--tier-color" as string]: tierColor }}>
        <div className="flex flex-col items-center gap-8 p-6 sm:flex-row sm:items-start sm:p-8">
          <TiltPedestal className="shrink-0">
            <figure className="gal-pedestal">
              <span className="gal-halo" aria-hidden="true" />
              {/* Owner-validated ring treatment: the home hero's rotating
                  rainbow emblem takes over from the flat gal-ring, floating
                  over an empty plinth that only keeps the pedestal's height. */}
              <div className="hero-emblem">
                <span className="hero-emblem-halo" aria-hidden="true" />
                <BadgeImage badge={badge} size={88} alt="" />
              </div>
              <div className="gal-plinth" aria-hidden="true" />
              <span className="gal-plinth-shadow" aria-hidden="true" />
            </figure>
            <figcaption className="gal-accession font-mono text-muted">
              {badge.set_id} · {t("version")} {badge.version}
            </figcaption>
          </TiltPedestal>
          <div className="gal-placard card min-w-0 flex-1 p-5 text-center sm:text-start">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {chips}
            </div>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {badge.title}
            </h1>
            {badge.description && (
              <p className="mt-2 text-sm text-muted">{badge.description}</p>
            )}
            {/* Reactions took the old button spot; copy-link + X moved to the
                right edge of the same row. */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:justify-between">
              <BadgeReactions
                slug={badge.slug}
                initial={reactionCounts}
                initialActive={myReactions}
              />
              <div className="flex flex-wrap items-center justify-center gap-2">
                {actions}
              </div>
            </div>
          </div>
        </div>
        {claimRail}
        {claimStrip}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {acquisitionSection}
          {ownershipSection}
        </div>
        <div className="space-y-6">
          {rarityPanel}
          {radarCard}
          {provenanceSection}
        </div>
      </div>
      {faqSection}
      {relatedSection}
      {SHOW_MARKET_MAP && marketMapSection}
    </div>
  );
}
