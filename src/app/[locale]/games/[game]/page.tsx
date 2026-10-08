import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { GAMES } from "@/lib/gamification/games";
import GameArt, { GAME_COLORS } from "@/components/games/GameArt";
import Coin from "@/components/Coin";
import { createClient } from "@/lib/supabase/server";
import { authUserId } from "@/lib/gamification/session";
import { getFeatures, getGames } from "@/lib/settings";
import { getJackpots } from "@/lib/queries";
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
import PinguGame from "@/components/games/PinguGame";
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
  const tc = await getTranslations("common");
  const meta = GAMES.find((g) => g.id === game);
  if (!meta) notFound();

  // Shared hero vars: the aurora wash reads --tier-color, the art frame
  // --gg-color — both set once here and inherited.
  const heroVars = {
    ["--tier-color" as string]: GAME_COLORS[game] ?? "var(--accent)",
    ["--gg-color" as string]: GAME_COLORS[game] ?? "var(--accent)",
  };

  // The playable board is gated by all three arcade switches, not only the hub's
  // tile list. With the master off or `features.games` disabled the page used to
  // render a full board whose every round the engine refuses; a single game
  // switched off in the panel rendered the board and then showed a raw English
  // error per round. Master / feature off shows the arcade-off copy; a single
  // disabled game 404s, matching the hub hiding its tile.
  const [settings, features] = await Promise.all([getGames(GAMES), getFeatures()]);

  // The bet range a tile/hero may advertise — same merge the hub uses, so the
  // hero can never promise limits the engine would refuse.
  const range = settings.games[game] ?? meta;

  // Recent big wins on this game for the card below — an anon read of the
  // public aggregate view stats_game_big_wins (0054). The view projects
  // game/bet/payout out of the payload as named columns, so the payload
  // itself never leaves the database and this page needs no service role.
  let bigWins: Array<{
    id: number;
    created_at: string;
    username: string;
    bet: number | null;
    payout: number | null;
    meters: number | null;
  }> = [];
  // The all-time podium is a second ordering of the same view — the top
  // payouts may all be older than the recent-8 list. Newest-first breaks
  // payout ties; both reads stay anonymous and ride the same view. meters is
  // pingu-only (payload-projected) and renders as a distance badge when set.
  let topWins: Array<{
    id: number;
    created_at: string;
    username: string;
    payout: number | null;
    meters: number | null;
  }> = [];
  {
    const supabase = await createClient();
    try {
      const [recentRes, podiumRes] = await Promise.all([
        supabase
          .from("stats_game_big_wins")
          .select("id,created_at,username,bet,payout,meters")
          .eq("game", game)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("stats_game_big_wins")
          .select("id,created_at,username,payout,meters")
          .eq("game", game)
          .order("payout", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(3),
      ]);
      bigWins = (recentRes.data ?? []) as typeof bigWins;
      topWins = (podiumRes.data ?? []) as typeof topWins;
    } catch {
      bigWins = [];
      topWins = [];
    }
  }
  const winsDate = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
  // Theme-aware medal tints — the .rank-row podium tokens (dark + light).
  const podiumColors = ["var(--rank-gold)", "var(--rank-silver)", "var(--rank-bronze)"];

  // Social proof for the login wall: what players have won on THIS game over
  // the last 7 days. null (not 0) on failure so a dead view hides the line
  // instead of claiming nobody won anything.
  let wonWeek: number | null = null;
  {
    const supabase = await createClient();
    try {
      const { data } = await supabase
        .from("stats_game_wins_week")
        .select("won_week")
        .eq("game", game)
        .maybeSingle();
      wonWeek = Number((data as { won_week: string | number } | null)?.won_week ?? 0);
    } catch {
      wonWeek = null;
    }
  }
  // Session read moved above the early returns so the podium card can greet
  // the viewer in every state; authUserId() only reads the session cookie.
  const userId = await authUserId();

  // Viewer standing for the podium card: their best big_win row on THIS game
  // and how many rows outrank it — the "progress" toward a podium place.
  let standing: { rank: number; payout: number } | null = null;
  let viewerName: string | null = null;
  if (userId) {
    try {
      const supabase = await createClient();
      const { data: profRow } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      viewerName = (profRow as { username: string | null } | null)?.username ?? null;
      if (viewerName) {
        const { data: best } = await supabase
          .from("stats_game_big_wins")
          .select("payout")
          .eq("game", game)
          .eq("username", viewerName)
          .order("payout", { ascending: false })
          .limit(1)
          .maybeSingle();
        const payout = Number((best as { payout: number | null } | null)?.payout ?? 0);
        if (payout > 0) {
          const { count } = await supabase
            .from("stats_game_big_wins")
            .select("id", { count: "exact", head: true })
            .eq("game", game)
            .gt("payout", payout);
          standing = { rank: (count ?? 0) + 1, payout };
        }
      }
    } catch {
      standing = null;
    }
  }

  // Progressive jackpots (0069) for the hero: this game's own pot plus the
  // Mega pot, from the same public read the hub strip uses. Shown in every
  // state (playable, login wall, arcade off) — the pots are the argument for
  // playing; null hides both chips on an unreachable table.
  const jackpots = await getJackpots();
  const gamePot = jackpots.find((j) => j.scope === game)?.pot ?? null;
  const megaPot = jackpots.find((j) => j.kind === "mega")?.pot ?? null;

  // One hero shell for EVERY state (playable, login wall, arcade off): the
  // game art makes the page recognizable even before login. `stats` is the
  // state-specific chip (last-round result) that only the playable state has.
  const hero = (stats?: ReactNode) => (
    <header
      className="gal-stage card flex flex-col items-center gap-5 p-6 sm:flex-row sm:p-8"
      style={heroVars}
    >
      <div className="gg-hero shrink-0" aria-hidden="true">
        <div className="gg-art-inner">
          <GameArt id={game} />
        </div>
      </div>
      <div className="min-w-0 flex-1 text-center sm:text-start">
        <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
          <Link href="/games" className="hover:text-foreground">
            {t("back")}
          </Link>
        </nav>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {t(`${game}Title`)}
        </h1>
        <p className="mt-1 text-sm text-muted">{t(`${game}Desc`)}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <span className="chip pointer-events-none">
            {t("betRange", { min: range.minBet, max: range.maxBet })}{" "}
            <Coin size={12} />
          </span>
          {gamePot !== null && megaPot !== null && (
            <>
              <span className="chip chip-gold pointer-events-none" dir="ltr">
                {t("jackpotChip", { n: gamePot })} <Coin size={12} />
              </span>
              <span className="chip chip-gold pointer-events-none" dir="ltr">
                {t("jackpotMegaChip", { n: megaPot })} <Coin size={12} variant="b" />
              </span>
            </>
          )}
          {stats}
        </div>
      </div>
    </header>
  );

  // Promotional hill, shown in EVERY state (playable, login wall, arcade off):
  // "someone already won this here" is the argument for logging in or for
  // switching the arcade back on.
  const bigWinsSection = (
    <section className="card p-6" aria-labelledby="big-wins-head">
      <h2 id="big-wins-head" className="text-lg font-extrabold tracking-tight">
        {t("bigWinsTitle")}
      </h2>
      {topWins.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {topWins.map((entry, index) => (
            <div
              key={entry.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: `color-mix(in srgb, ${podiumColors[index]} 40%, var(--line))`,
              }}
            >
              <span className="font-extrabold" style={{ color: podiumColors[index] }}>
                {index + 1}.
              </span>
              <Link
                href={`/profile/${entry.username}`}
                className="min-w-0 truncate font-bold hover:text-accent"
              >
                {entry.username}
              </Link>
              <span
                dir="ltr"
                className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums"
                style={{ color: podiumColors[index] }}
              >
                {entry.meters != null && (
                  <span className="text-[0.625rem] font-semibold opacity-80">
                    {Number(entry.meters).toLocaleString(locale)} m ·
                  </span>
                )}
                {(entry.payout ?? 0).toLocaleString(locale)} <Coin size={11} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {standing ? (
        <p className="mt-3 text-xs text-muted">
          {viewerName && topWins.some((entry) => entry.username === viewerName) ? (
            <span className="font-bold text-success">{t("bigWinsYou")}</span>
          ) : (
            t("bigWinsYourBest", {
              amount: standing.payout.toLocaleString(locale),
              rank: standing.rank,
            })
          )}
        </p>
      ) : null}
      {bigWins.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {bigWins.map((win) => (
            <li key={win.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <Link href={`/profile/${win.username}`} className="font-bold hover:text-accent">
                {win.username}
              </Link>
              {/* dir="ltr" island: "bet → win" is a numeric expression that must
                  keep its order under RTL (the FeedList/hero-chip pattern). */}
              <span dir="ltr" className="inline-flex items-center gap-1.5 text-xs text-muted tabular-nums">
                {t("bigWinsBet")}
                <span className="inline-flex items-center gap-1 font-bold text-foreground">
                  {win.bet?.toLocaleString(locale) ?? "–"} <Coin size={11} />
                </span>
                <span aria-hidden>→</span>
                <span className="inline-flex items-center gap-1 font-bold text-success">
                  {win.payout?.toLocaleString(locale) ?? "–"} <Coin size={11} />
                </span>
                {win.meters != null && (
                  <span className="font-semibold text-foreground/80">
                    · {Number(win.meters).toLocaleString(locale)} m
                  </span>
                )}
              </span>
              <time dateTime={win.created_at} className="ms-auto text-xs text-muted">
                {winsDate.format(new Date(win.created_at))}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("bigWinsEmpty")}</p>
      )}
    </section>
  );

  if (!settings.enabled || !features.games) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {hero()}
        <p className="card p-6 text-center text-sm text-muted">{t("disabled")}</p>
        {bigWinsSection}
      </div>
    );
  }
  if (settings.games[game]?.enabled === false) notFound();

  if (!userId) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {hero()}
        <div className="card p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">{t("howToPlay")}</p>
          <p className="mx-auto mt-2 max-w-md text-sm">{t(`${game}Hint`)}</p>
          {wonWeek !== null && wonWeek > 0 ? (
            <p className="mx-auto mt-4 inline-flex max-w-full items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              <span className="min-w-0">{t("wallWonWeek", { won: wonWeek })}</span>
            </p>
          ) : null}
          <p className="mt-5 text-sm text-muted">{t("loginRequired")}</p>
          <div className="mt-6">
            <TwitchLoginButton />
          </div>
        </div>
        {bigWinsSection}
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

  // The visitor's most recent settled rounds on THIS game, for the hero chip:
  // the last one as a signed amount plus a five-dot win/loss streak.
  // game_rounds is public-read under RLS, so the anon server client suffices
  // (same access pattern as the catalog read on the same page); the (user_id,
  // created_at desc) index serves the top-5. Net is computed here — the table
  // stores absolute payout and bet, never the difference.
  let lastRoundChip: ReactNode = null;
  {
    const supabase = await createClient();
    const { data: recent } = await supabase
      .from("game_rounds")
      .select("bet,payout")
      .eq("user_id", userId)
      .eq("game", game)
      .order("created_at", { ascending: false })
      .limit(5);
    const rounds = (recent ?? []) as Array<{ bet: number; payout: number }>;
    if (rounds.length > 0) {
      const net = rounds[0].payout - rounds[0].bet;
      lastRoundChip = (
        <span
          className={`chip pointer-events-none ${
            net > 0 ? "chip-live" : net < 0 ? "chip-danger" : ""
          }`}
        >
          {t("lastRound")}{" "}
          {/* dir="ltr" island: a bare "+200" text node loses its sign in the
              RTL paragraph (Arabic-Indic digits never attach to it) — the
              FeedList win/loss pattern. */}
          <span dir="ltr" className="inline-flex items-center gap-1 tabular-nums">
            {net > 0 ? "+" : net < 0 ? "−" : ""}
            {Math.abs(net).toLocaleString(locale)} <Coin size={12} />
          </span>
          {/* Five-dot streak, newest left (the roulette round-history
              direction), pinned with dir="ltr" so RTL keeps the order. Purely
              decorative: the signed amount beside it is the accessible
              summary, so color-only dots stay aria-hidden. */}
          <span aria-hidden="true" dir="ltr" className="ms-1 inline-flex items-center gap-1">
            {rounds.map((r, i) => {
              const n = r.payout - r.bet;
              return (
                <span
                  key={i}
                  className={`size-2 rounded-full ${
                    n > 0 ? "bg-success" : n < 0 ? "bg-danger" : "bg-muted"
                  } ${i === 0 ? "ring-1 ring-accent" : ""}`}
                />
              );
            })}
          </span>
        </span>
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {hero(lastRoundChip)}
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
      {game === "pingu" && <PinguGame />}
      {bigWinsSection}
    </div>
  );
}
