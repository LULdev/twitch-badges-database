import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSiteStats } from "@/lib/queries";
import BadgeGrid from "@/components/badges/BadgeGrid";
import RarityChip from "@/components/badges/RarityChip";
import { RARITY_COLORS, RARITY_TIERS, type RarityTier } from "@/lib/rarity";
import { formatCompact } from "@/components/badges/BadgeCard";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "stats" });
  return { title: t("title"), description: t("subtitle") };
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-xs font-semibold text-muted">
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            backgroundColor: color ?? "var(--accent)",
          }}
        />
      </div>
      <span className="w-12 shrink-0 text-end text-xs font-bold tabular-nums">
        {formatCompact(value)}
      </span>
    </div>
  );
}

export default async function StatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("stats");
  const tr = await getTranslations("rarity");

  const stats = await getSiteStats().catch(() => null);

  if (!stats) {
    return (
      <div className="card p-10 text-center text-sm text-muted">
        {t("totalBadges")}: —
      </div>
    );
  }

  const tiles = [
    { label: t("totalBadges"), value: stats.totalBadges },
    { label: t("activeBadges"), value: stats.active },
    { label: t("upcomingBadges"), value: stats.upcoming },
    { label: t("expiredBadges"), value: stats.expired },
    { label: t("freeBadges"), value: stats.free },
    { label: t("paidBadges"), value: stats.paid },
  ];

  const maxRarity = Math.max(
    1,
    ...RARITY_TIERS.map((tier) => stats.rarityDistribution[tier] ?? 0),
  );
  const maxCategory = Math.max(1, ...stats.categoryCounts.map((c) => c.count));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="card stat-tile">
            <dd className="stat-value">{new Intl.NumberFormat(locale).format(tile.value)}</dd>
            <dt className="stat-label">{tile.label}</dt>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="rarity-dist" className="card p-6">
          <h2 id="rarity-dist" className="mb-4 font-bold">
            {t("rarityDistribution")}
          </h2>
          <div className="space-y-2.5">
            {RARITY_TIERS.map((tier: RarityTier) => (
              <Bar
                key={tier}
                label={tr(tier)}
                value={stats.rarityDistribution[tier] ?? 0}
                max={maxRarity}
                color={RARITY_COLORS[tier]}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {RARITY_TIERS.map((tier) => (
              <RarityChip key={tier} tier={tier} compact />
            ))}
          </div>
        </section>

        <section aria-labelledby="categories" className="card p-6">
          <h2 id="categories" className="mb-4 font-bold">
            {t("categoryBreakdown")}
          </h2>
          <div className="max-h-80 space-y-2.5 overflow-y-auto pe-1">
            {stats.categoryCounts.map((row) => (
              <Bar
                key={row.category}
                label={row.category}
                value={row.count}
                max={maxCategory}
              />
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="newest">
        <div className="section-title">
          <h2 id="newest">{t("newestBadges")}</h2>
          <Link href="/badges" className="text-xs font-semibold text-accent hover:underline">
            {t("badges")} →
          </Link>
        </div>
        <BadgeGrid badges={stats.newestBadges} showCountdown={false} />
      </section>
    </div>
  );
}
