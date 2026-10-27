import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { authUserId } from "@/lib/gamification/session";
import { getProgress } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";
import { GAMES } from "@/lib/gamification/games";
import { getFeatures, getGames } from "@/lib/settings";
import { getPostBySlug } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { isoWeekLabel } from "@/lib/blog";
import DailyClaim from "@/components/DailyClaim";
import LevelBadge from "@/components/LevelBadge";
import Coin from "@/components/Coin";
import GameIcon from "@/components/GameIcon";
import GameArt, { GAME_COLORS } from "@/components/games/GameArt";
import JackpotStrip from "@/components/games/JackpotStrip";
import Reveal from "@/components/stats/Reveal";
import { getJackpots, getJackpotPotsYesterday, getRecentJackpotWins, getTopJackpotWins } from "@/lib/queries";
import { getArcadeMonth, getArcadeMonthTop } from "@/lib/stats";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Podium medal tints — the .rank-row tokens, same source as the jackpot
// hall of fame and the leaderboards wagered board.
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "games" });
  return {
    title: t("hubTitle"),
    description: t("hubSubtitle"),
    alternates: {
      canonical: `/${locale}/games`,
      languages: localeAlternates("/games"),
    },
  };
}

export default async function GamesHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");

  const userId = await authUserId();
  let level: ReturnType<typeof levelFromXp> | null = null;
  let coins = 0;
  let gameStreak = 0;
  if (userId) {
    const progress = await getProgress(userId).catch(() => null);
    if (progress) {
      level = levelFromXp(progress.xp);
      coins = progress.coins;
      gameStreak = progress.game_streak;
    }
  }

  // BOTH switches gate the hub. The hub used to honour the master switch only, so
  // a `features.games=false` arcade still listed all thirteen tiles while every
  // round answered 403. The bet bounds shown on each tile come from the same
  // settings, so a tile can never advertise a range the engine would refuse.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);
  const visible =
    settings.enabled && features.games
      ? GAMES.filter((game) => settings.games[game.id]?.enabled !== false)
      : [];

  // Recap banner data: the newest recap post is looked up by its EXACT
  // date/week-stamped slug through the public-read catalog (blog_posts is
  // anon-readable; the heartbeat table is not since 0043), so no service
  // role is involved. Candidates: today's post (published 06:00), yesterday's,
  // and — on Mondays — the weekly one. `new Date()` in a dynamic server
  // component is hydration-safe (no client re-render of this text).
  const now = new Date();
  const daySlug = (offset: number) =>
    `arcade-highlights-${
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset),
      )
        .toISOString()
        .slice(0, 10)
    }`;
  const candidates = [daySlug(0), daySlug(1)];
  if (now.getUTCDay() === 1) {
    const monday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7),
    );
    candidates.push(`arcade-weekly-${isoWeekLabel(monday)}`);
  }
  const recaps = (
    await Promise.all(candidates.map((slug) => getPostBySlug(slug).catch(() => null)))
  ).filter((p): p is NonNullable<typeof p> => !!p);
  const latestRecap =
    recaps.sort(
      (a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    )[0] ?? null;

  // Big-wins ticker: the three newest big wins across ALL games, from the
  // public aggregate view stats_game_big_wins (0054) — an anon read, no
  // service role. Hidden entirely while no big win has ever landed.
  let ticker: Array<{
    id: number;
    created_at: string;
    username: string;
    coins_amount: number | null;
    game: string | null;
    meters: number | null;
  }> = [];
  {
    const supabase = await createClient();
    try {
      const { data } = await supabase
        .from("stats_game_big_wins")
        .select("id,created_at,username,coins_amount,game,meters")
        .order("created_at", { ascending: false })
        .limit(3);
      ticker = (data ?? []) as typeof ticker;
    } catch {
      ticker = [];
    }
  }

  // Progressive jackpots (0069): the Mega pot plus every game pot, one anon
  // read, the newest winners for the recency row and the biggest ever for the
  // hall-of-fame row. An empty result (unreachable table) hides the strip —
  // the arcade must not depend on the jackpot surface existing. The
  // yesterday-snapshot map (0072) feeds the strip's since-yesterday chips;
  // the month-top read (0078) feeds the Hall-of-the-month podium below the
  // community banner.
  const [jackpots, jackpotWins, jackpotHall, arcadeMonth, yesterdayPots, monthTop3] =
    await Promise.all([
      getJackpots(),
      getRecentJackpotWins(3),
      getTopJackpotWins(3),
      getArcadeMonth(),
      getJackpotPotsYesterday(),
      getArcadeMonthTop(),
    ]);

  return (
    <div className="space-y-8">
      <header className="gal-stage card flex flex-col items-center gap-5 p-6 sm:flex-row sm:p-8">
        {level && <LevelBadge level={level.level} size={72} />}
        <div className="min-w-0 flex-1 text-center sm:text-start">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("hubTitle")}</h1>
          <p className="mt-1 text-sm text-muted">{t("hubSubtitle")}</p>
          {level && (
            <div className="mt-3">
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.round(level.progress * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted tabular-nums">
                {t("level")} {level.level} · {level.xpIntoLevel}/{level.xpForNext || "∞"} XP · <span className="inline-flex items-center gap-1">{coins.toLocaleString(locale)} <Coin size={13} /></span>{gameStreak > 0 && <> · {t("gameStreak", { n: gameStreak })}</>}
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2">
          <DailyClaim compact />
          <Link href="/wheel" className="btn btn-primary btn-sm">
            <GameIcon id="wheel" size={14} />
            {t("wheelLink")}
          </Link>
        </div>
      </header>

      {/* Community month (0076): the rolling 30-day totals as a one-line
          banner — the "we together" companion to every profile's own month
          summary. Hidden when the view is unreachable or the month was quiet. */}
      {arcadeMonth && arcadeMonth.rounds > 0 && (
        <div className="card flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm text-muted">
          <span
            className="size-2 rounded-full"
            style={{ background: "var(--accent)" }}
            aria-hidden="true"
          />
          {t("communityMonth", {
            rounds: arcadeMonth.rounds.toLocaleString(locale),
            wagered: arcadeMonth.wagered.toLocaleString(locale),
            players: arcadeMonth.players.toLocaleString(locale),
          })}
          {arcadeMonth.wageredPrior >= 100 && arcadeMonth.wagered > 0 && (
            <span className="text-accent">
              {(() => {
                const pct = Math.round(
                  ((arcadeMonth.wagered - arcadeMonth.wageredPrior) /
                    arcadeMonth.wageredPrior) * 100,
                );
                if (Math.abs(pct) < 5) return t("communityTrendFlat");
                return t(
                  pct > 0 ? "communityTrendUp" : "communityTrendDown",
                  { pct: Math.abs(pct).toLocaleString(locale) },
                );
              })()}
            </span>
          )}
        </div>
      )}

      {/* Hall of the month (0078): the trailing-30-day top 3 by settled
          rounds — the community banner's numbers given faces. Mounts only
          when the view has rows (a quiet month shows the banner alone). */}
      {monthTop3.length > 0 && (
        <section className="card p-4" aria-labelledby="month-podium-head">
          <h2
            id="month-podium-head"
            className="text-sm font-bold uppercase tracking-[0.08em] text-muted"
          >
            {t("monthPodiumTitle")}
          </h2>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {monthTop3.map((entry, index) => (
              <li
                key={entry.username}
                className="flex items-center gap-3 rounded-[var(--radius-input)] border p-3"
                style={{
                  borderColor: `color-mix(in srgb, ${MEDALS[index]} 45%, var(--line))`,
                }}
              >
                <span
                  className="jackpot-hof-rank"
                  style={{ color: MEDALS[index] }}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Avatar src={entry.avatarUrl} name={entry.username} />
                <Link
                  href={`/profile/${entry.username}`}
                  className="min-w-0 flex-1 hover:text-accent"
                >
                  <span className="block truncate text-sm font-bold">
                    {entry.username}
                  </span>
                  <span className="block text-xs text-muted" dir="ltr">
                    {t("monthPodiumLine", {
                      rounds: entry.rounds.toLocaleString(locale),
                      wagered: entry.wagered.toLocaleString(locale),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {jackpots.length > 0 && (
        <JackpotStrip
          jackpots={jackpots}
          wins={jackpotWins}
          hallOfFame={jackpotHall}
          locale={locale}
          yesterdayPots={yesterdayPots}
        />
      )}

      {ticker.length > 0 && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span
              className="size-2 rounded-full"
              style={{ background: "var(--warning)" }}
              aria-hidden
            />
            {t("bigWinsTitle")}
          </span>
          {ticker.map((win) => (
            <span
              key={win.id}
              className="group flex items-center gap-2"
            >
              <span
                className="size-2 rounded-full"
                style={{ background: GAME_COLORS[win.game ?? ""] ?? "var(--accent)" }}
                aria-hidden
              />
              {win.game ? (
                <Link href={`/games/${win.game}`} className="font-bold group-hover:text-accent">
                  {win.username}
                </Link>
              ) : (
                <span className="font-bold">{win.username}</span>
              )}
              {win.game && <span className="text-xs text-muted">{t(`${win.game}Title`)}</span>}
              <span
                dir="ltr"
                className="inline-flex items-center gap-1 font-bold text-success tabular-nums"
              >
                +{(win.coins_amount ?? 0).toLocaleString(locale)} <Coin size={12} />
                {win.meters != null && (
                  <span className="text-[0.625rem] font-semibold text-muted">
                    {Number(win.meters).toLocaleString(locale)} m
                  </span>
                )}
              </span>
            </span>
          ))}
        </div>
      )}

      {visible.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted">
          <span>{t("recapNext", { time: "06:00" })}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/blog?tag=arcade" className="btn btn-secondary btn-sm shrink-0">
              {t("recapAll")}
            </Link>
            {latestRecap && (
              <Link
                href={`/blog/${latestRecap.slug}`}
                className="btn btn-secondary btn-sm shrink-0"
              >
                {t("recapLatest")}
                <span className="dir-arrow" aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">{t("disabled")}</div>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((game, i) => {
          const range = settings.games[game.id] ?? game;
          return (
          <Reveal key={game.id} delay={i * 70} className="h-full">
            <Link
              href={`/games/${game.id}`}
              className="card card-interactive gg-tile flex h-full flex-col"
              style={{ ["--gg-color" as string]: GAME_COLORS[game.id] ?? "var(--accent)" }}
            >
              <div className="gg-art" aria-hidden="true">
                <span className="gg-flag chip pointer-events-none text-[0.5625rem]">
                  {game.type === "luck" ? t("luck") : t("skill")}
                </span>
                <div className="gg-art-inner">
                  <GameArt id={game.id} />
                </div>
              </div>
              <div className="gg-body">
                <h2 className="font-bold leading-tight">{t(`${game.id}Title`)}</h2>
                <p className="text-xs leading-relaxed text-muted">{t(`${game.id}Desc`)}</p>
                <div className="mt-auto flex items-center gap-1.5 pt-2">
                  <span className="chip pointer-events-none text-[0.5625rem]">
                    {range.minBet}–{range.maxBet} <Coin size={12} />
                  </span>
                </div>
              </div>
            </Link>
          </Reveal>
          );
        })}
      </div>
      )}
    </div>
  );
}
