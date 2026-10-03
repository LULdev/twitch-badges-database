import { createAdminClient } from "@/lib/supabase/admin";
import { GAMES } from "@/lib/gamification/games";
import { logChange } from "@/lib/changelog";
import {
  buildArcadeHighlightsArticle,
  buildArcadeWeeklyArticle,
  createFeaturePost,
  isoWeekLabel,
} from "@/lib/blog";
import { sendPushToAll, recordNotification } from "@/lib/push";

export interface ArcadeHighlightsSummary {
  day: string;
  slug: string;
  totalRounds: number;
  topGame: string | null;
  biggestWinUsername: string | null;
  published: boolean;
  skipped: boolean;
  /** Present on Mondays (or forced): the weekly recap outcome. */
  weekly?: {
    isoWeek: string;
    slug: string;
    totalRounds: number;
    priorWeekTotal: number | null;
    topGame: string | null;
    published: boolean;
    skipped: boolean;
    failed: boolean;
    error?: string;
  };
}

/** Per-game exact head count for a [start, end) window — the achievements
 *  precedent: head counts are not clamped by PostgREST's 1000-row cap. */
async function countRounds(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<Array<{ id: string; game: string; rounds: number }>> {
  return Promise.all(
    GAMES.map(async (meta) => {
      const { count } = await supabase
        .from("game_rounds")
        .select("id", { count: "exact", head: true })
        .eq("game", meta.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());
      return { id: meta.id, game: meta.title, rounds: count ?? 0 };
    }),
  );
}

/** Streak Freeze saves in [start, end) — one activity_events row per rescue
 *  (the gate's -1 sentinel caps one per user per UTC day). Served by the
 *  (kind, created_at desc) index from 0009; head count, no row cap. */
async function countStreakSaves(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<number> {
  const { count } = await supabase
    .from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "streak_freeze")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  return count ?? 0;
}

/** Feed-logged coin movement in [start, end): gross sum of |coins_amount|
 *  (net would cancel earn against spend and understate the flow). PostgREST
 *  cannot aggregate, so the rows are read and reduced — paged defensively
 *  because a single response caps at 1000 rows (the achievements pageAll
 *  doctrine). Volume today is < 100 rows/week for the whole site. */
async function countCoinFlow(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("activity_events")
      .select("id, coins_amount")
      .not("coins_amount", "is", null)
      .neq("coins_amount", 0)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Array<{ coins_amount: number | null }>;
    total += page.reduce((sum, row) => sum + Math.abs(row.coins_amount ?? 0), 0);
    if (page.length < 1000) break;
  }
  return total;
}

/** Biggest won round in [start, end): server-side max ordering returns the
 *  true maximum in one row (the achievements trick). Net is computed by the
 *  caller — the table never stores the difference. */
async function biggestWin(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<{
  id: string;
  game: string;
  bet: number;
  payout: number;
  username: string | null;
} | null> {
  const { data: winRow } = await supabase
    .from("game_rounds")
    .select("game,user_id,bet,payout")
    .eq("won", true)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("payout", { ascending: false })
    .limit(1)
    .maybeSingle();
  const win = winRow as
    | { game: string; user_id: string; bet: number; payout: number }
    | null;
  if (!win) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", win.user_id)
    .maybeSingle();
  const meta = GAMES.find((g) => g.id === win.game);
  return {
    id: meta?.id ?? win.game,
    game: meta?.title ?? win.game,
    bet: win.bet,
    payout: win.payout,
    username: (profile as { username: string | null } | null)?.username ?? null,
  };
}

/**
 * Daily arcade recap (+ weekly recap on Mondays), one auto blog post per UTC
 * calendar day / ISO week. The daily post covers the PREVIOUS day (the 06:00
 * UTC global cron calls this, so "yesterday" has fully closed); the weekly
 * post covers the previous ISO week Mon–Sun and only fires on Mondays —
 * both idempotent through their date-stamped slugs (createFeaturePost's
 * onConflict ignoreDuplicates), so re-runs are silent no-ops.
 *
 * The weekly branch is folded into the SAME heartbeat unit deliberately: a
 * separate weekly unit would pin the public status verdict "degraded" for up
 * to seven days on one thrown error (stats.ts reads last_status per source),
 * while this unit self-heals with the next daily run. The weekly branch
 * therefore catches internally and never fails the daily half.
 *
 * A day/week with zero rounds is SKIPPED, not posted — and the skip is
 * recorded (logChange), never silently returned.
 */
export async function runArcadeHighlights(
  opts: { push?: boolean; forceWeekly?: boolean } = {},
): Promise<ArcadeHighlightsSummary> {
  const push = opts.push ?? true;
  const supabase = createAdminClient();

  /* ---------------- daily: previous UTC calendar day ---------------- */
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = start.toISOString().slice(0, 10);
  const slug = `arcade-highlights-${day}`;

  const summary: ArcadeHighlightsSummary = {
    day,
    slug,
    totalRounds: 0,
    topGame: null,
    biggestWinUsername: null,
    published: false,
    skipped: false,
  };

  const counts = await countRounds(supabase, start, end);
  summary.totalRounds = counts.reduce((sum, g) => sum + g.rounds, 0);
  const [win, daySaves, dayCoinFlow] = await Promise.all([
    biggestWin(supabase, start, end),
    countStreakSaves(supabase, start, end),
    countCoinFlow(supabase, start, end),
  ]);
  summary.biggestWinUsername = win?.username ?? null;

  const played = counts.filter((g) => g.rounds > 0);
  const top = played.length
    ? [...played].sort((a, b) => b.rounds - a.rounds)[0]
    : null;
  summary.topGame = top?.game ?? null;

  if (summary.totalRounds === 0) {
    summary.skipped = true;
    await logChange(
      {
        kind: "data_sync",
        title: "Arcade highlights skipped — no rounds",
        body: `No game rounds were settled on ${day}, so no daily recap post was published. The step will run again after the next UTC day closes.`,
        payload: { ranAt: new Date().toISOString(), day, skipped: true },
      },
      supabase,
    );
  } else {
    const { title, excerpt, content } = buildArcadeHighlightsArticle({
      day,
      roundsByGame: counts,
      biggestWin: win,
      streakSaves: daySaves,
      coinFlow: dayCoinFlow,
    });
    summary.published = await createFeaturePost({
      slug,
      title,
      excerpt,
      content,
      // The day's most-played game as the cover: the exported standalone
      // GameArt SVG (scripts/export-game-art.ts), same source of truth as
      // the hub tiles and detail heroes.
      cover: top ? `/games/art/${top.id}.svg` : null,
      tags: ["arcade", "daily"],
    });

    if (summary.published && push) {
      // Locale-less URL on purpose: the service worker navigates
      // root-relative and next-intl prepends the active locale.
      const url = `/blog/${slug}`;
      recordNotification({
        kind: "blog",
        title,
        body: excerpt,
        url,
        tag: "arcade-highlights",
      }).catch(() => undefined);
      sendPushToAll(
        { title, body: excerpt, url, tag: "arcade-highlights" },
        { recapOnly: true },
      ).catch(
        () => undefined,
      );
    }

    await logChange(
      {
        kind: "data_sync",
        title: summary.published
          ? `Arcade highlights published for ${day}`
          : `Arcade highlights already recorded for ${day}`,
        body: summary.published
          ? `Daily arcade recap for ${day}: ${summary.totalRounds} settled rounds${summary.topGame ? `, most played: ${summary.topGame}` : ""}${summary.biggestWinUsername ? `, biggest win by ${summary.biggestWinUsername}` : ""}. Post published at /blog/${slug}${top ? ` with the ${top.game} cover` : ""}.`
          : `The recap post for ${day} already existed (idempotent re-run); no duplicate was created.`,
        payload: {
          ranAt: new Date().toISOString(),
          day,
          published: summary.published,
          totalRounds: summary.totalRounds,
          topGame: summary.topGame,
          chars: content.length,
          streakSaves: daySaves,
          coinFlow: dayCoinFlow,
        },
      },
      supabase,
    );
  }

  /* ------- weekly: previous ISO week, Mondays only (or forced) ------- */
  const isMonday = now.getUTCDay() === 1;
  if (isMonday || opts.forceWeekly) {
    try {
      // Snap to Monday: on the real Monday run, today-7 IS the previous
      // Monday, but a forced off-Monday run (testing) must still cover a
      // clean Mon–Sun week, not "the last 7 days".
      const daysBackToMonday = (now.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      const wStart = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 7 - daysBackToMonday,
        ),
      );
      const wEnd = new Date(wStart.getTime() + 7 * 86_400_000);
      const pStart = new Date(wStart.getTime() - 7 * 86_400_000);
      const isoWeek = isoWeekLabel(wStart);
      const wSlug = `arcade-weekly-${isoWeek}`;

      const [wCounts, pCounts, wWin, wSaves, wCoinFlow] = await Promise.all([
        countRounds(supabase, wStart, wEnd),
        countRounds(supabase, pStart, wStart),
        biggestWin(supabase, wStart, wEnd),
        countStreakSaves(supabase, wStart, wEnd),
        countCoinFlow(supabase, wStart, wEnd),
      ]);
      const wTotal = wCounts.reduce((sum, g) => sum + g.rounds, 0);
      const pTotal = pCounts.reduce((sum, g) => sum + g.rounds, 0);
      const wPlayed = wCounts.filter((g) => g.rounds > 0);
      const wTop = wPlayed.length
        ? [...wPlayed].sort((a, b) => b.rounds - a.rounds)[0]
        : null;

      const weekly: NonNullable<ArcadeHighlightsSummary["weekly"]> = {
        isoWeek,
        slug: wSlug,
        totalRounds: wTotal,
        priorWeekTotal: pTotal,
        topGame: wTop?.game ?? null,
        published: false,
        skipped: false,
        failed: false,
      };
      summary.weekly = weekly;

      if (wTotal === 0) {
        weekly.skipped = true;
        await logChange(
          {
            kind: "data_sync",
            title: `Arcade weekly skipped — no rounds in ${isoWeek}`,
            body: `No game rounds were settled in week ${isoWeek}, so no weekly recap post was published.`,
            payload: {
              ranAt: new Date().toISOString(),
              isoWeek,
              skipped: true,
            },
          },
          supabase,
        );
      } else {
        const wArticle = buildArcadeWeeklyArticle({
          isoWeek,
          weekStart: wStart.toISOString().slice(0, 10),
          weekEnd: new Date(wEnd.getTime() - 1).toISOString().slice(0, 10),
          roundsByGame: wCounts,
          priorWeekTotal: pTotal,
          biggestWin: wWin,
          streakSaves: wSaves,
          coinFlow: wCoinFlow,
        });
        weekly.published = await createFeaturePost({
          slug: wSlug,
          title: wArticle.title,
          excerpt: wArticle.excerpt,
          content: wArticle.content,
          cover: wTop ? `/games/art/${wTop.id}.svg` : null,
          tags: ["arcade", "weekly"],
        });

        if (weekly.published && push) {
          // Own collapse tag: a weekly push must not replace the daily one
          // in the notification tray (or vice versa).
          const url = `/blog/${wSlug}`;
          recordNotification({
            kind: "blog",
            title: wArticle.title,
            body: wArticle.excerpt,
            url,
            tag: "arcade-weekly",
          }).catch(() => undefined);
          sendPushToAll(
            {
              title: wArticle.title,
              body: wArticle.excerpt,
              url,
              tag: "arcade-weekly",
            },
            { recapOnly: true },
          ).catch(() => undefined);
        }

        await logChange(
          {
            kind: "data_sync",
            title: weekly.published
              ? `Arcade weekly published for ${isoWeek}`
              : `Arcade weekly already recorded for ${isoWeek}`,
            body: weekly.published
              ? `Weekly arcade recap for ${isoWeek}: ${wTotal} settled rounds${wTop ? `, game of the week: ${wTop.game}` : ""}${pTotal > 0 ? `, ${wTotal >= pTotal ? "up" : "down"} on the prior week's ${pTotal}` : ""}. Post at /blog/${wSlug}.`
              : `The weekly recap for ${isoWeek} already existed (idempotent re-run).`,
            payload: {
              ranAt: new Date().toISOString(),
              isoWeek,
              published: weekly.published,
              totalRounds: wTotal,
              priorWeekTotal: pTotal,
              topGame: weekly.topGame,
              chars: wArticle.content.length,
              streakSaves: wSaves,
              coinFlow: wCoinFlow,
            },
          },
          supabase,
        );
      }
    } catch (error) {
      // Never fail the daily half: record and move on.
      summary.weekly = {
        ...(summary.weekly ?? {
          isoWeek: "unknown",
          slug: "unknown",
          totalRounds: 0,
          priorWeekTotal: null,
          topGame: null,
          published: false,
          skipped: false,
        }),
        failed: true,
        error: error instanceof Error ? error.message : "failed",
      };
      console.warn("[arcade-highlights] weekly branch failed:", error);
    }
  }

  return summary;
}
