import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getMostOwnedBadges,
  getRarestBadges,
  getSiteLeaderboard,
} from "@/lib/queries";
import {
  fetchOwnedLeaderboard,
  fetchBadgesBlogRanking,
} from "@/lib/twitch/potat";
import { BadgeImage } from "@/components/badges/BadgeImage";
import RarityChip from "@/components/badges/RarityChip";
import { formatCompact } from "@/components/badges/BadgeCard";
import { localeAlternates } from "@/lib/seo";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "leaderboards" });
  return {
    alternates: {
      canonical: `/${locale}/leaderboards`,
      languages: localeAlternates("/leaderboards"),
    }, title: t("title"), description: t("subtitle") };
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} width={28} height={28} className="rounded-full" loading="lazy" />
    );
  }
  return (
    <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-[0.625rem] font-bold text-accent">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export default async function LeaderboardsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("leaderboards");
  const tc = await getTranslations("common");

  const [potat, badgesblog, mostOwned, rarest, site] = await Promise.all([
    fetchOwnedLeaderboard(2).catch(() => []),
    fetchBadgesBlogRanking().catch(() => []),
    getMostOwnedBadges(10).catch(() => []),
    getRarestBadges(10).catch(() => []),
    getSiteLeaderboard(25).catch(() => []),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      {/* Worldwide collectors (potat) */}
      <section aria-labelledby="top-collectors" className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 id="top-collectors" className="font-bold">
            {t("topCollectors")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t("topCollectorsDesc")}</p>
        </div>
        {potat.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14">{t("rank")}</th>
                  <th>{t("collector")}</th>
                  <th className="text-end">{t("badges")}</th>
                </tr>
              </thead>
              <tbody>
                {potat.slice(0, 50).map((entry) => (
                  <tr key={entry.twitch_id} className="hover:bg-surface-2">
                    <td className="font-bold tabular-nums text-muted">#{entry.rank}</td>
                    <td>
                      <Link
                        href={`/profile/${entry.bestName.toLowerCase()}`}
                        className="flex items-center gap-2.5 font-semibold hover:text-accent"
                      >
                        <Avatar src={entry.user_pfp} name={entry.bestName} />
                        {entry.bestName}
                      </Link>
                    </td>
                    <td className="text-end font-semibold tabular-nums">
                      {new Intl.NumberFormat(locale).format(entry.owned_badges)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-6 text-sm text-muted">{t("empty")}</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Most owned badges */}
        <section aria-labelledby="most-owned" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="most-owned" className="font-bold">{t("mostOwned")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("mostOwnedDesc")}</p>
          </div>
          <ul className="divide-y divide-line">
            {mostOwned.map((badge, index) => (
              <li key={badge.id}>
                <Link
                  href={`/badges/${badge.slug}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2"
                >
                  <span className="w-6 text-center text-xs font-bold tabular-nums text-muted">
                    {index + 1}
                  </span>
                  <BadgeImage badge={badge} size={28} alt="" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {badge.title}
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {formatCompact(badge.owner_count, locale)}
                  </span>
                </Link>
              </li>
            ))}
            {mostOwned.length === 0 && (
              <li className="p-6 text-sm text-muted">{tc("setupHint")}</li>
            )}
          </ul>
        </section>

        {/* Rarest badges */}
        <section aria-labelledby="rarest-badges" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="rarest-badges" className="font-bold">{t("rarestBadges")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("rarestBadgesDesc")}</p>
          </div>
          <ul className="divide-y divide-line">
            {rarest.map((badge, index) => (
              <li key={badge.id}>
                <Link
                  href={`/badges/${badge.slug}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2"
                >
                  <span className="w-6 text-center text-xs font-bold tabular-nums text-muted">
                    {index + 1}
                  </span>
                  <BadgeImage badge={badge} size={28} alt="" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {badge.title}
                  </span>
                  <RarityChip tier={badge.rarity_tier} score={badge.rarity_score} compact />
                </Link>
              </li>
            ))}
            {rarest.length === 0 && (
              <li className="p-6 text-sm text-muted">{tc("setupHint")}</li>
            )}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* badges.blog community top 100 */}
        <section aria-labelledby="badgesblog" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="badgesblog" className="font-bold">{t("badgesblogRanking")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("badgesblogRankingDesc")}</p>
          </div>
          {badgesblog.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <table className="data-table">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th className="w-14">{t("rank")}</th>
                    <th>{t("collector")}</th>
                    <th className="text-end">{t("badges")}</th>
                  </tr>
                </thead>
                <tbody>
                  {badgesblog.map((entry) => (
                    <tr key={entry.twitch_id} className="hover:bg-surface-2">
                      <td className="font-bold tabular-nums text-muted">
                        #{entry.rank_position}
                      </td>
                      <td>
                        <Link
                          href={`/profile/${entry.login}`}
                          className="flex items-center gap-2.5 font-semibold hover:text-accent"
                        >
                          <Avatar src={entry.profile_image} name={entry.display_name} />
                          {entry.display_name}
                        </Link>
                      </td>
                      <td className="text-end font-semibold tabular-nums">
                        {new Intl.NumberFormat(locale).format(entry.badge_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-6 text-sm text-muted">{t("empty")}</p>
          )}
        </section>

        {/* Site collectors */}
        <section aria-labelledby="site-collectors" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="site-collectors" className="font-bold">{t("siteCollectors")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("siteCollectorsDesc")}</p>
          </div>
          {site.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14">{t("rank")}</th>
                  <th>{t("collector")}</th>
                  <th className="text-end">{t("badges")}</th>
                </tr>
              </thead>
              <tbody>
                {site.map((entry, index) => (
                  <tr key={entry.user_id} className="hover:bg-surface-2">
                    <td className="font-bold tabular-nums text-muted">#{index + 1}</td>
                    <td>
                      <Link
                        href={`/profile/${entry.username}`}
                        className="flex items-center gap-2.5 font-semibold hover:text-accent"
                      >
                        <Avatar src={entry.avatar_url} name={entry.username} />
                        {entry.display_name ?? entry.username}
                      </Link>
                    </td>
                    <td className="text-end font-semibold tabular-nums">
                      {new Intl.NumberFormat(locale).format(entry.badges_owned)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-muted">{t("empty")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
