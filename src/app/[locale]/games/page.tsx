import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { authUserId } from "@/lib/gamification/session";
import { getProgress } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";
import { GAMES } from "@/lib/gamification/games";
import { getFeatures, getGames } from "@/lib/settings";
import { getPostBySlug } from "@/lib/queries";
import { isoWeekLabel } from "@/lib/blog";
import DailyClaim from "@/components/DailyClaim";
import LevelBadge from "@/components/LevelBadge";
import Coin from "@/components/Coin";
import GameIcon from "@/components/GameIcon";
import GameArt, { GAME_COLORS } from "@/components/games/GameArt";
import Reveal from "@/components/stats/Reveal";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

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
  if (userId) {
    const progress = await getProgress(userId).catch(() => null);
    if (progress) {
      level = levelFromXp(progress.xp);
      coins = progress.coins;
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
                {t("level")} {level.level} · {level.xpIntoLevel}/{level.xpForNext || "∞"} XP · <span className="inline-flex items-center gap-1">{coins.toLocaleString(locale)} <Coin size={13} /></span>
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2">
          <DailyClaim compact />
          <Link href="/wheel" className="btn btn-primary text-xs">
            <GameIcon id="wheel" size={14} />
            {t("wheelLink")}
          </Link>
        </div>
      </header>

      {visible.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted">
          <span>{t("recapNext", { time: "06:00" })}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/blog?tag=arcade" className="btn btn-secondary text-xs shrink-0">
              {t("recapAll")}
            </Link>
            {latestRecap && (
              <Link
                href={`/blog/${latestRecap.slug}`}
                className="btn btn-secondary text-xs shrink-0"
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
                    {range.minBet}–{range.maxBet} <Coin size={11} />
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
