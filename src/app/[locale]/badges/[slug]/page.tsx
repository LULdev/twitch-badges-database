import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getBadgeBySlug,
  getBadgeStatsHistory,
  listBadges,
} from "@/lib/queries";
import { BadgeImage } from "@/components/badges/BadgeImage";
import RarityChip from "@/components/badges/RarityChip";
import Countdown from "@/components/badges/Countdown";
import { StatusChip } from "@/components/badges/BadgeCard";
import { jsonLdScript } from "@/lib/jsonld";
import { buildBadgeFaq } from "@/lib/badges/faq";
import BadgeGrid from "@/components/badges/BadgeGrid";
import OwnersChart from "@/components/charts/OwnersChart";
import ShareButtons from "@/components/ShareButtons";
import LiveRefresher from "@/components/LiveRefresher";
import { localeAlternates } from "@/lib/seo";
import { fetchBadgeLiveStats } from "@/lib/twitch/potat";

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
    twitter: { card: "summary", title, description },
  };
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function BadgeDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("badges");
  const tFaq = await getTranslations("badgeFaq");
  const tcd = await getTranslations("countdown");
  const tc = await getTranslations("common");
  // Percentages with a locale-correct decimal separator; `toFixed` always
  // emitted "." regardless of locale.
  const percent = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Deliberately no .catch here: getBadgeBySlug returns null only for a missing
  // slug, so a real query error now surfaces instead of becoming a 404.
  const badge = await getBadgeBySlug(slug);
  if (!badge) notFound();

  const [history, related, live] = await Promise.all([
    getBadgeStatsHistory(badge.id).catch(() => []),
    // Without a category the filter would be a no-op and the section would
    // list the global newest badges under a "same category" heading.
    badge.category
      ? listBadges({ category: badge.category, perPage: 7 }).catch(() => null)
      : Promise.resolve(null),
    fetchBadgeLiveStats(badge.set_id).catch(() => null),
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
  // The live wearer count is the fresher reading of the holding metric, so it
  // wins over the stored poll; both mean the same thing.
  const holding = live?.userCount ?? badge.active_count ?? null;

  const faq = buildBadgeFaq(badge, {
    locale,
    t: tFaq,
    liveUserCount: live?.userCount ?? null,
    livePercentage: live?.percentage ?? null,
  });

  /**
   * The owner's trajectory, in words. The chart below already draws the curve,
   * but a reader who only wants the conclusion should not have to interpret it:
   * this compares the oldest and newest owner counts that are actually
   * recorded. Both ends must be real numbers — a trend built on a null endpoint
   * would invent a direction the data does not support, so it returns null and
   * the section is omitted rather than guessed.
   */
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
      // A band, not a threshold: a 0.4% drift between two polls is noise from
      // a badge that is simply not being claimed, and calling that "growing"
      // would be a claim the data cannot support.
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
   * row (helix = Twitch's own catalog API, badgebase = the curated badge index,
   * custom = hand-added in the panel), so it is the honest answer to "why
   * should I trust these numbers" — a badge whose numbers come from a different
   * pipeline behave differently from one scraped from Twitch directly.
   */
  const SOURCE_KEYS: Record<string, string> = {
    helix: "sourceHelix",
    badgebase: "sourceBadgebase",
    custom: "sourceCustom",
    sync: "sourceSync",
  };
  const sourceLabel = t(SOURCE_KEYS[badge.source] ?? "sourceOther");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: badge.title,
    description: badge.description ?? badge.how_to_earn ?? badge.title,
    image: badge.image_url_4x ?? badge.image_url_2x ?? undefined,
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
      url: `/${locale}/badges/${badge.slug}`,
    },
  };

  return (
    <div className="space-y-8">
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

      <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
        <Link href="/badges" className="hover:text-foreground">
          {tc("viewAll")}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{badge.title}</span>
      </nav>

      {/* Header card */}
      <section className="card overflow-hidden">
        <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-2xl border border-line bg-surface-2 p-4">
            <BadgeImage badge={badge} size={96} alt="" />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-start">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <StatusChip status={badge.status} />
              <RarityChip tier={badge.rarity_tier} score={badge.rarity_score} />
              <span className="chip pointer-events-none">
                {badge.is_paid ? tc("paid") : tc("free")}
              </span>
              <span className="chip pointer-events-none">{badge.category}</span>
            </div>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {badge.title}
            </h1>
            {badge.description && (
              <p className="mt-2 text-sm text-muted">{badge.description}</p>
            )}
            <p className="mt-2 font-mono text-xs text-muted">
              {t("setId")}: {badge.set_id} · {t("version")}: {badge.version}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {badge.click_url && (
                <a
                  href={badge.click_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary text-xs"
                >
                  {t("openOnTwitch")} ↗
                </a>
              )}
              <ShareButtons
                path={`/${locale}/badges/${badge.slug}`}
                title={`${badge.title} — Twitch Badges Database`}
              />
            </div>
          </div>
        </div>

        {/* Countdown strip */}
        {(badge.status === "active" || badge.status === "upcoming") &&
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
          )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Facts */}
        <section className="card space-y-5 p-6 lg:col-span-1">
          <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">
            {t("availability")}
          </h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{badge.start_date ? t("started") : t("released")}</dt>
              <dd className="text-end font-medium">
                {formatDate(badge.start_date ?? badge.release_date ?? badge.first_seen_at, locale)}
              </dd>
            </div>
            {badge.end_date && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t("ends")}</dt>
                <dd className="text-end font-medium">{formatDate(badge.end_date, locale)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("firstSeen")}</dt>
              <dd className="text-end font-medium">{formatDate(badge.first_seen_at, locale)}</dd>
            </div>
          </dl>

          <h2 className="pt-2 text-sm font-bold uppercase tracking-[0.08em] text-muted">
            {tc("owners")}
          </h2>
          {/*
            One source per metric.

            The block used to stack up to four numbers: `owner_count`,
            `active_count`, the live `userCount` and `percentage` — plus the
            live `percentage` folded into the live row. `active_count` and the
            live `userCount` are the SAME metric (potat's current holder count)
            arriving from two sources, as are `percentage` and
            `live.percentage`. Because the two sources are polled at different
            times they routinely disagreed, so the page stated two different
            answers to "how many people have this badge" and a visitor had no
            way to tell which was current.

            Now each figure is picked once, from the freshest source available,
            and the poll timestamp is shown so a stale number is self-evident.
          */}
          {totalOwners === null ? (
            <p className="text-sm text-muted">{t("ownersNoData")}</p>
          ) : (
            <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 p-4">
              <p className="text-3xl font-black tabular-nums">
                {new Intl.NumberFormat(locale).format(totalOwners)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t("ownersHeadline", { count: totalOwners })}
              </p>
              {share !== null && (
                <p className="mt-1 text-xs text-muted">
                  {t("ownersShare", { value: percent.format(share) })}
                </p>
              )}
            </div>
          )}
          {holding !== null && holding !== totalOwners && (
            <dl className="space-y-3 pt-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t("currentlyHolding")}</dt>
                <dd className="font-semibold tabular-nums">
                  {new Intl.NumberFormat(locale).format(holding)}
                </dd>
              </div>
              {badge.last_polled_at && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("ownersUpdated")}</dt>
                  <dd className="text-end font-medium">
                    {formatDate(badge.last_polled_at, locale)}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
              {t("aboutRarity")}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">{t("rarityFormula")}</p>
          </div>
        </section>

        {/* How to earn + chart */}
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">
              {t("howToEarn")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed">
              {badge.how_to_earn ?? badge.description ?? t("howToEarnUnknown")}
            </p>
          </section>

          <section className="card p-6">
            <div className="section-title">
              <h2>{t("ownerTrend")}</h2>
            </div>
            <p className="-mt-4 mb-3 text-xs text-muted">{t("ownerTrendSubtitle")}</p>
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
          </section>

          {/* Where this record comes from, and the full history of the badge in
              one block. Both are answers a collector actually asks and neither
              is anywhere else on the page. Every row is conditional: a badge
              with no claim window has no window row, and a badge still running
              has no removal row. */}
          <section className="card p-6">
            <div className="section-title">
              <h2>{t("recordDetails")}</h2>
            </div>
            <p className="-mt-4 mb-4 text-xs text-muted">
              {t("sourceLabel")}: {sourceLabel}
            </p>
            <dl className="space-y-3 text-sm">
              {badge.first_seen_at && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("firstDetected")}</dt>
                  <dd className="text-end font-medium">
                    {formatDate(badge.first_seen_at, locale)}
                  </dd>
                </div>
              )}
              {badge.release_date && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("releaseDate")}</dt>
                  <dd className="text-end font-medium">
                    {formatDate(badge.release_date, locale)}
                  </dd>
                </div>
              )}
              {badge.start_date && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("claimOpens")}</dt>
                  <dd className="text-end font-medium">
                    {formatDate(badge.start_date, locale)}
                  </dd>
                </div>
              )}
              {badge.end_date && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("claimCloses")}</dt>
                  <dd className="text-end font-medium">
                    {formatDate(badge.end_date, locale)}
                  </dd>
                </div>
              )}
              {badge.last_seen_at && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("lastSeen")}</dt>
                  <dd className="text-end font-medium">
                    {formatDate(badge.last_seen_at, locale)}
                  </dd>
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
          </section>
        </div>
      </div>

      {faq.items.length > 0 && (
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
      )}

      {relatedBadges.length > 0 && (
        <section aria-labelledby="related">
          <div className="section-title">
            <h2 id="related">{t("sameCategory", { category: badge.category })}</h2>
          </div>
          <BadgeGrid badges={relatedBadges} showCountdown={false} />
        </section>
      )}
    </div>
  );
}
