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
import BadgeGrid from "@/components/badges/BadgeGrid";
import OwnersChart from "@/components/charts/OwnersChart";
import ShareButtons from "@/components/ShareButtons";
import LiveRefresher from "@/components/LiveRefresher";
import { localeAlternates } from "@/lib/seo";
import { fetchBadgeLiveStats } from "@/lib/twitch/potat";

export const revalidate = 120;

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
    openGraph: {
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
  const tcd = await getTranslations("countdown");
  const tc = await getTranslations("common");

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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: badge.title,
    description: badge.description ?? badge.how_to_earn ?? badge.title,
    image: badge.image_url_4x ?? badge.image_url_2x ?? undefined,
    category: badge.category,
  };

  return (
    <div className="space-y-8">
      <LiveRefresher intervalMs={120_000} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      <nav className="text-xs text-muted" aria-label="Breadcrumb">
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
            <BadgeImage badge={badge} size={96} />
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
                  : tcd("expiresIn")}
              </span>
              <Countdown
                size="lg"
                target={
                  badge.status === "upcoming" && badge.start_date
                    ? badge.start_date
                    : (badge.end_date ?? badge.start_date!)
                }
                mode={badge.status === "upcoming" && badge.start_date ? "starts" : "expires"}
              />
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
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("ownerCount", { count: badge.owner_count ?? 0 })}</dt>
              <dd className="font-semibold tabular-nums">
                {badge.owner_count !== null
                  ? new Intl.NumberFormat(locale).format(badge.owner_count)
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("activeCount", { count: badge.active_count ?? 0 })}</dt>
              <dd className="font-semibold tabular-nums">
                {badge.active_count !== null
                  ? new Intl.NumberFormat(locale).format(badge.active_count)
                  : "—"}
              </dd>
            </div>
            {live?.userCount !== null && live?.userCount !== undefined && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">
                  <span className="me-1.5 inline-block size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
                  {t("liveCount")}
                </dt>
                <dd className="font-semibold tabular-nums text-success">
                  {new Intl.NumberFormat(locale).format(live.userCount)}
                  {live.percentage !== null
                    ? ` (${Number(live.percentage).toFixed(2)}%)`
                    : ""}
                </dd>
              </div>
            )}
            {badge.percentage !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">%</dt>
                <dd className="font-semibold tabular-nums">
                  {t("percentageOfUsers", { value: Number(badge.percentage).toFixed(2) })}
                </dd>
              </div>
            )}
          </dl>

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
            {chartData.length >= 2 ? (
              <OwnersChart data={chartData} />
            ) : (
              <p className="py-8 text-center text-sm text-muted">{t("noStats")}</p>
            )}
          </section>
        </div>
      </div>

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
