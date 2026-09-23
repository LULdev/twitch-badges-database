import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { authUserId } from "@/lib/gamification/session";
import { getProgress } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";
import { GAMES } from "@/lib/gamification/games";
import { getFeatures, getGames } from "@/lib/settings";
import DailyClaim from "@/components/DailyClaim";
import LevelBadge from "@/components/LevelBadge";
import Coin from "@/components/Coin";
import GameIcon from "@/components/GameIcon";
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

  return (
    <div className="space-y-8">
      <header className="card flex flex-col items-center gap-5 p-6 sm:flex-row">
        {level && <LevelBadge level={level.level} size={72} />}
        <div className="flex-1 text-center sm:text-start">
          <h1 className="text-2xl font-extrabold tracking-tight">{t("hubTitle")}</h1>
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
        <div className="flex flex-col items-center gap-2">
          <DailyClaim compact />
          <Link href="/wheel" className="btn btn-primary text-xs">
            <GameIcon id="wheel" size={14} />
            {t("wheelLink")}
          </Link>
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">{t("disabled")}</div>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((game) => {
          const range = settings.games[game.id] ?? game;
          return (
          <Link
            key={game.id}
            href={`/games/${game.id}`}
            className="card card-interactive flex flex-col gap-2 p-5"
          >
            <span className="text-accent">
              <GameIcon id={game.id} size={30} />
            </span>
            <h2 className="font-bold leading-tight">{t(`${game.id}Title`)}</h2>
            <p className="text-xs leading-relaxed text-muted">{t(`${game.id}Desc`)}</p>
            <div className="mt-auto flex items-center gap-1.5 pt-2">
              <span className="chip pointer-events-none text-[0.5625rem]">
                {game.type === "luck" ? t("luck") : t("skill")}
              </span>
              <span className="chip pointer-events-none text-[0.5625rem]">
                {range.minBet}–{range.maxBet} <Coin size={11} />
              </span>
            </div>
          </Link>
          );
        })}
      </div>
      )}
    </div>
  );
}
