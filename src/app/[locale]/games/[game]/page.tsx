import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GAMES } from "@/lib/gamification/games";
import { createClient } from "@/lib/supabase/server";
import { authUserId } from "@/lib/gamification/session";
import { getFeatures, getGames } from "@/lib/settings";
import TwitchLoginButton from "@/components/TwitchLoginButton";
import RpsGame from "@/components/games/RpsGame";
import CoinflipGame from "@/components/games/CoinflipGame";
import HiloGame from "@/components/games/HiloGame";
import RouletteGame from "@/components/games/RouletteGame";
import BlackjackGame from "@/components/games/BlackjackGame";
import VaultGame from "@/components/games/VaultGame";
import ScratchGame from "@/components/games/ScratchGame";
import TowerGame from "@/components/games/TowerGame";
import SlotsGame from "@/components/games/SlotsGame";
import ShootGame from "@/components/games/ShootGame";
import MemoryGame from "@/components/games/MemoryGame";
import QuizGame from "@/components/games/QuizGame";
import CatcherGame from "@/components/games/CatcherGame";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ locale: string; game: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, game } = await params;
  if (!GAMES.some((g) => g.id === game)) return {
    alternates: {
      canonical: `/${locale}/games/${game}`,
      languages: localeAlternates(`/games/${game}`),
    },};
  const t = await getTranslations({ locale, namespace: "games" });
  // The valid-game branch returned no `alternates`, so these 143 pages (one per
  // locale per game) canonicalised to the locale home page — contradicting the
  // sitemap, which lists them with hreflang. The invalid-game branch above always
  // had them; this brings the branch that actually renders into line.
  return {
    title: t(`${game}Title`),
    description: t(`${game}Desc`),
    alternates: {
      canonical: `/${locale}/games/${game}`,
      languages: localeAlternates(`/games/${game}`),
    },
  };
}

export default async function GamePage({ params }: PageProps) {
  const { locale, game } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("games");
  const meta = GAMES.find((g) => g.id === game);
  if (!meta) notFound();

  // The playable board is gated by all three arcade switches, not only the hub's
  // tile list. With the master off or `features.games` disabled the page used to
  // render a full board whose every round the engine refuses; a single game
  // switched off in the panel rendered the board and then showed a raw English
  // error per round. Master / feature off shows the arcade-off copy; a single
  // disabled game 404s, matching the hub hiding its tile.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);
  if (!settings.enabled || !features.games) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t(`${game}Title`)}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">{t("disabled")}</p>
      </div>
    );
  }
  if (settings.games[game]?.enabled === false) notFound();

  const userId = await authUserId();
  if (!userId) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t(`${game}Title`)}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">{t("loginRequired")}</p>
        <div className="mt-8">
          <TwitchLoginButton />
        </div>
      </div>
    );
  }

  // Quiz needs a badge pool from the catalog. Read with the anon client: the
  // catalog is public-read, so this page needs no RLS bypass.
  let quizBadges: Array<{ slug: string; title: string; image: string | null }> = [];
  if (game === "quiz") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("badges")
      .select("slug,title,image_url_2x")
      .neq("status", "removed")
      .limit(60);
    quizBadges = ((data ?? []) as Array<{ slug: string; title: string; image_url_2x: string | null }>)
      .map((row) => ({ slug: row.slug, title: row.title, image: row.image_url_2x }))
      .filter((row) => row.image);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t(`${game}Title`)}</h1>
        <p className="mt-1 text-sm text-muted">{t(`${game}Desc`)}</p>
      </header>
      {game === "rps" && <RpsGame />}
      {game === "coinflip" && <CoinflipGame />}
      {game === "hilo" && <HiloGame />}
      {game === "roulette" && <RouletteGame />}
      {game === "blackjack" && <BlackjackGame />}
      {game === "vault" && <VaultGame />}
      {game === "scratch" && <ScratchGame />}
      {game === "tower" && <TowerGame />}
      {game === "slots" && <SlotsGame />}
      {game === "shoot" && <ShootGame />}
      {game === "memory" && <MemoryGame />}
      {game === "quiz" &&
        (quizBadges.length >= 4 ? (
          <QuizGame badges={quizBadges} />
        ) : (
          // Without this the page rendered a header and then nothing at all,
          // which reads as a broken page rather than an empty catalog.
          <div className="card p-8 text-center text-sm text-muted">
            {t("notEnoughBadges")}
          </div>
        ))}
      {game === "catcher" && <CatcherGame />}
    </div>
  );
}
