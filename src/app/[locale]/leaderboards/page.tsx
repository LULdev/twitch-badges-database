import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getLoginStreakLeaderboard,
  getMostOwnedBadges,
  getRarestBadges,
  getSiteLeaderboard,
  getStreakLeaderboard,
  getWageredLeaderboard,
} from "@/lib/queries";
import {
  fetchOwnedLeaderboard,
  fetchBadgesBlogRanking,
} from "@/lib/twitch/potat";
import { BadgeImage } from "@/components/badges/BadgeImage";
import RarityChip from "@/components/badges/RarityChip";
import { formatCompact } from "@/components/badges/BadgeCard";
import { localeAlternates } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { readProgress } from "@/lib/gamification/xp";

// Live data (potat leaderboards, rankings) — never prerender. With a loading
// boundary in the segment the build actually executes this page's fetches
// during static generation; eleven parallel locale workers then trip potat's
// rate limit (Retry-After: 60) and the export times out.
export const dynamic = "force-dynamic";

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

// Podium medal tints for the wagered board's top 3 — the .rank-row podium
// tokens (dark + light), same source as the jackpot hall of fame.
const MEDALS = ["var(--rank-gold)", "var(--rank-silver)", "var(--rank-bronze)"];

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

  const [potat, badgesblog, mostOwned, rarest, site, streaks, loginStreaks, wagered] =
    await Promise.all([
      fetchOwnedLeaderboard(2).catch(() => []),
      fetchBadgesBlogRanking().catch(() => []),
      getMostOwnedBadges(10).catch(() => []),
      getRarestBadges(10).catch(() => []),
      getSiteLeaderboard(25).catch(() => []),
      getStreakLeaderboard().catch(() => []),
      getLoginStreakLeaderboard().catch(() => []),
      getWageredLeaderboard().catch(() => []),
    ]);

  // The viewer's own streak standing — the profile rankChip pattern (head
  // count above me + the next value ahead), shown under the streak boards
  // for logged-in members with a non-zero best. Anonymous visits skip all
  // of it (readProgress never creates a row, and no chip renders).
  const streakYou: {
    game: { mine: number; rank: number; toFirst: number } | null;
    login: { mine: number; rank: number; toFirst: number } | null;
  } = { game: null, login: null };
  {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const progress = await readProgress(user.id).catch(() => null);
      if (progress) {
        const chip = async (
          col: "best_game_streak" | "best_login_streak",
          mine: number,
        ): Promise<{ mine: number; rank: number; toFirst: number } | null> => {
          if (mine <= 0) return null;
          const [{ count }, { data: next }] = await Promise.all([
            supabase
              .from("user_progress")
              .select("user_id", { count: "exact", head: true })
              .gt(col, mine),
            supabase
              .from("user_progress")
              .select(col)
              .gt(col, mine)
              .order(col, { ascending: true })
              .limit(1)
              .maybeSingle(),
          ]);
          const nextVal = Number(
            (next as Record<string, unknown> | null)?.[col] ?? 0,
          );
          return { mine, rank: (count ?? 0) + 1, toFirst: Math.max(0, nextVal - mine) };
        };
        streakYou.game = await chip("best_game_streak", progress.best_game_streak ?? 0);
        streakYou.login = await chip("best_login_streak", progress.best_login_streak ?? 0);
      }
    }
  }

  const fmtInt = new Intl.NumberFormat(locale);

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

        {/* Most coins wagered — the activity board (0073's turnover counter) */}
        <section aria-labelledby="most-wagered" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="most-wagered" className="font-bold">{t("wageredTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("wageredDesc")}</p>
          </div>
          {wagered.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14">{t("rank")}</th>
                  <th>{t("collector")}</th>
                  <th className="text-end">{t("wageredUnit")}</th>
                </tr>
              </thead>
              <tbody>
                {wagered.map((entry, index) => (
                  <tr key={entry.user_id} className="hover:bg-surface-2">
                    <td className="font-bold tabular-nums text-muted">
                      {index < 3 ? (
                        <span
                          className="jackpot-hof-rank"
                          style={{ color: MEDALS[index] }}
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                      ) : (
                        <>#{index + 1}</>
                      )}
                    </td>
                    <td>
                      {entry.profile ? (
                        <Link
                          href={`/profile/${entry.profile.username}`}
                          className="flex items-center gap-2.5 font-semibold hover:text-accent"
                        >
                          <Avatar src={entry.profile.avatar_url} name={entry.profile.username} />
                          {entry.profile.username}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td dir="ltr" className="text-end font-semibold tabular-nums">
                      {new Intl.NumberFormat(locale).format(entry.coins_wagered)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-muted">{t("empty")}</p>
          )}
        </section>

        {/* Best game streaks */}
        <section aria-labelledby="best-streaks" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="best-streaks" className="font-bold">{t("streakTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("streakDesc")}</p>
          </div>
          {streaks.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14">{t("rank")}</th>
                  <th>{t("collector")}</th>
                  <th className="text-end">{t("streakUnit")}</th>
                </tr>
              </thead>
              <tbody>
                {streaks.map((entry, index) => (
                  <tr key={entry.user_id} className="hover:bg-surface-2">
                    <td className="font-bold tabular-nums text-muted">#{index + 1}</td>
                    <td>
                      {entry.profile ? (
                        <Link
                          href={`/profile/${entry.profile.username}`}
                          className="flex items-center gap-2.5 font-semibold hover:text-accent"
                        >
                          <Avatar src={entry.profile.avatar_url} name={entry.profile.username} />
                          {entry.profile.username}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-end font-semibold tabular-nums">
                      {new Intl.NumberFormat(locale).format(entry.best_game_streak)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-muted">{t("empty")}</p>
          )}
          {streakYou.game && (
            <p className="border-t border-line px-5 py-2 text-xs text-muted">
              {t("youStreakRank", {
                n: fmtInt.format(streakYou.game.mine),
                rank: streakYou.game.rank,
              })}
              {streakYou.game.toFirst > 0
                ? " · " +
                  t("youStreakToFirst", { n: fmtInt.format(streakYou.game.toFirst) })
                : ""}
            </p>
          )}
        </section>

        {/* Longest login streaks — the game-streak board's sibling with the
            column swapped to best_login_streak (0007's high-water mark). */}
        <section aria-labelledby="best-login-streaks" className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="best-login-streaks" className="font-bold">{t("loginStreakTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("loginStreakDesc")}</p>
          </div>
          {loginStreaks.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-14">{t("rank")}</th>
                  <th>{t("collector")}</th>
                  <th className="text-end">{t("streakUnit")}</th>
                </tr>
              </thead>
              <tbody>
                {loginStreaks.map((entry, index) => (
                  <tr key={entry.user_id} className="hover:bg-surface-2">
                    <td className="font-bold tabular-nums text-muted">#{index + 1}</td>
                    <td>
                      {entry.profile ? (
                        <Link
                          href={`/profile/${entry.profile.username}`}
                          className="flex items-center gap-2.5 font-semibold hover:text-accent"
                        >
                          <Avatar src={entry.profile.avatar_url} name={entry.profile.username} />
                          {entry.profile.username}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-end font-semibold tabular-nums">
                      {new Intl.NumberFormat(locale).format(entry.best_login_streak)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-muted">{t("empty")}</p>
          )}
          {streakYou.login && (
            <p className="border-t border-line px-5 py-2 text-xs text-muted">
              {t("youStreakRank", {
                n: fmtInt.format(streakYou.login.mine),
                rank: streakYou.login.rank,
              })}
              {streakYou.login.toFirst > 0
                ? " · " +
                  t("youStreakToFirst", { n: fmtInt.format(streakYou.login.toFirst) })
                : ""}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
