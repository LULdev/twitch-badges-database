import { createAdminClient } from "@/lib/supabase/admin";
import { GAMES } from "@/lib/gamification/games";
import { logChange } from "@/lib/changelog";
import {
  buildArcadeHighlightsArticle,
  buildArcadeMonthlyArticle,
  buildArcadeWeeklyArticle,
  createFeaturePost,
  isoWeekLabel,
  type ArcadeJackpotStats,
} from "@/lib/blog";
import { sendPushToAll, recordNotification } from "@/lib/push";

export interface ArcadeHighlightsSummary {
  day: string;
  slug: string;
  totalRounds: number;
  topGame: string | null;
  biggestWinUsername: string | null;
  /** Live pots snapshot + windowed hits feeding the recap's jackpot line. */
  jackpot: ArcadeJackpotStats | null;
  /** Busiest player of the trailing 30 days (the recap's pace-setter line). */
  monthTop: { username: string; rounds: number } | null;
  published: boolean;
  skipped: boolean;
  /** Present on Mondays (or forced): the weekly recap outcome. */
  weekly?: {
    isoWeek: string;
    slug: string;
    totalRounds: number;
    priorWeekTotal: number | null;
    topGame: string | null;
    jackpot: ArcadeJackpotStats | null;
    /** The week's FIRST moon landing (0081): earliest 10x+ Badge Rocket
     *  cash-out — the recap's nerve-of-the-week line. */
    moonFirst: { username: string; mult: number } | null;
    published: boolean;
    skipped: boolean;
    failed: boolean;
    error?: string;
  };
  /** Present on the 1st of a UTC month (or forced): the monthly recap outcome. */
  monthly?: {
    month: string;
    slug: string;
    totalRounds: number;
    priorMonthTotal: number | null;
    topGame: string | null;
    monthTop: { username: string; rounds: number } | null;
    jackpot: ArcadeJackpotStats | null;
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

/** Logged coin movement in [start, end): gross sum of |coins_amount|
 *  (net would cancel earn against spend and understate the flow). Counts
 *  every ledger row — including admin corrections, which never reach the
 *  public feed. PostgREST
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

/** Progressive-jackpot numbers for a recap window (0069): the LIVE pots as a
 *  snapshot (sum over the jackpots table — the same numbers the hub strip
 *  and the game heroes show) plus the hits paid inside [start, end) from the
 *  public history. Null on any error: the recap line is omitted rather than
 *  wrong. Hits are rare by design, so the windowed read fetches rows — no
 *  paging concern at 1-in-4000+ odds. */
async function jackpotStats(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<ArcadeJackpotStats | null> {
  try {
    const [potsRes, winsRes] = await Promise.all([
      supabase.from("jackpots").select("scope,kind,pot"),
      supabase
        .from("jackpot_wins")
        .select("amount")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()),
    ]);
    if (potsRes.error || winsRes.error) return null;
    const pots = (potsRes.data ?? []) as Array<{ scope: string; kind: string; pot: string | number }>;
    const wins = (winsRes.data ?? []) as Array<{ amount: string | number }>;
    return {
      potsTotal: pots.reduce((sum, row) => sum + Number(row.pot ?? 0), 0),
      megaPot: Number(pots.find((row) => row.kind === "mega")?.pot ?? 0),
      hits: wins.length,
      paid: wins.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    };
  } catch {
    return null;
  }
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

/** Busiest player in [start, end) — the rolling-30d pace-setter for the
 *  daily recap and the calendar-month champion for the monthly recap. PostgREST cannot GROUP BY,
 *  so the window's user_id rows are read and counted in JS, paged
 *  defensively like countCoinFlow (1000-row response cap; the volume today
 *  is well under 500 rows/month). Gated at >= 10 rounds so a quiet month
 *  never crowns a two-round "champion", and null on any error or unnamed
 *  winner — the recap sentence is omitted rather than wrong. */
async function monthTop(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<{ username: string; rounds: number } | null> {
  try {
    const perUser = new Map<string, number>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("game_rounds")
        .select("user_id")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      const page = (data ?? []) as Array<{ user_id: string }>;
      for (const row of page) {
        perUser.set(row.user_id, (perUser.get(row.user_id) ?? 0) + 1);
      }
      if (page.length < 1000) break;
    }
    let topUserId = "";
    let topRounds = 0;
    for (const [userId, rounds] of perUser) {
      if (rounds > topRounds) {
        topUserId = userId;
        topRounds = rounds;
      }
    }
    if (!topUserId || topRounds < 10) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", topUserId)
      .maybeSingle();
    const username = (profile as { username: string | null } | null)?.username;
    if (!username) return null;
    return { username, rounds: topRounds };
  } catch {
    return null;
  }
}

/** The week's first moon landing: the earliest 10x+ banked Badge Rocket
 *  cash-out in [start, end) — the weekly recap's nerve line (0081). The
 *  moon flag is written by the settlement tail, so this reads SETTLED wins
 *  only; null on no landing / any error (the sentence is simply omitted). */
async function firstMoonLanding(
  supabase: ReturnType<typeof createAdminClient>,
  start: Date,
  end: Date,
): Promise<{ username: string; mult: number } | null> {
  try {
    const { data } = await supabase
      .from("game_rounds")
      .select("user_id,payout,result,profile:profiles(username)")
      .eq("game", "crash")
      .eq("won", true)
      .contains("result", { moon: true })
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as {
      user_id: string;
      payout: number | string;
      result: Record<string, unknown>;
      profile: { username: string } | null | Array<{ username: string }>;
    };
    const username = Array.isArray(row.profile) ? row.profile[0]?.username : row.profile?.username;
    const mult = Number(row.result.cashed ?? 0);
    if (!username || !Number.isFinite(mult) || mult < 10) return null;
    return { username, mult };
  } catch {
    return null;
  }
}

/**
 * Daily arcade recap (+ weekly on Mondays, + monthly on the 1st), one auto
 * blog post per UTC calendar day / ISO week / calendar month. The daily post covers the PREVIOUS day (the 06:00
 * UTC global cron calls this, so "yesterday" has fully closed); the weekly
 * post covers the previous ISO week Mon–Sun and only fires on Mondays —
 * both idempotent through their date-stamped slugs (createFeaturePost's
 * onConflict ignoreDuplicates), so re-runs are silent no-ops.
 *
 * The weekly and monthly branches are folded into the SAME heartbeat unit
 * deliberately: a
 * separate weekly unit would pin the public status verdict "degraded" for up
 * to seven days on one thrown error (stats.ts reads last_status per source),
 * while this unit self-heals with the next daily run. Both side branches
 * therefore catch internally and never fail the daily half.
 *
 * A day/week with zero rounds is SKIPPED, not posted — and the skip is
 * recorded (logChange), never silently returned.
 */
export async function runArcadeHighlights(
  opts: { push?: boolean; forceWeekly?: boolean; forceMonthly?: boolean } = {},
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
    jackpot: null,
    monthTop: null,
    published: false,
    skipped: false,
  };

  const counts = await countRounds(supabase, start, end);
  summary.totalRounds = counts.reduce((sum, g) => sum + g.rounds, 0);
  const [win, daySaves, dayCoinFlow, dayJackpot, dayMonthTop] = await Promise.all([
    biggestWin(supabase, start, end),
    countStreakSaves(supabase, start, end),
    countCoinFlow(supabase, start, end),
    jackpotStats(supabase, start, end),
    monthTop(supabase, new Date(end.getTime() - 30 * 86_400_000), end),
  ]);
  summary.biggestWinUsername = win?.username ?? null;
  summary.jackpot = dayJackpot;
  summary.monthTop = dayMonthTop;

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
      jackpot: dayJackpot,
      monthTop: dayMonthTop,
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
          ? `Daily arcade recap for ${day}: ${summary.totalRounds} settled rounds${summary.topGame ? `, most played: ${summary.topGame}` : ""}${summary.biggestWinUsername ? `, biggest win by ${summary.biggestWinUsername}` : ""}${dayMonthTop ? `, month pace-setter ${dayMonthTop.username} (${dayMonthTop.rounds} rounds)` : ""}. Post published at /blog/${slug}${top ? ` with the ${top.game} cover` : ""}.`
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
          jackpotHits: dayJackpot?.hits ?? 0,
          jackpotPaid: dayJackpot?.paid ?? 0,
          jackpotPotsTotal: dayJackpot?.potsTotal ?? null,
          jackpotMegaPot: dayJackpot?.megaPot ?? null,
          monthTopUser: dayMonthTop?.username ?? null,
          monthTopRounds: dayMonthTop?.rounds ?? 0,
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

      const [wCounts, pCounts, wWin, wSaves, wCoinFlow, wJackpot, wMoon] = await Promise.all([
        countRounds(supabase, wStart, wEnd),
        countRounds(supabase, pStart, wStart),
        biggestWin(supabase, wStart, wEnd),
        countStreakSaves(supabase, wStart, wEnd),
        countCoinFlow(supabase, wStart, wEnd),
        jackpotStats(supabase, wStart, wEnd),
        firstMoonLanding(supabase, wStart, wEnd),
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
        jackpot: wJackpot,
        moonFirst: wMoon,
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
          jackpot: wJackpot,
          moonFirst: wMoon,
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
              jackpotHits: wJackpot?.hits ?? 0,
              jackpotPaid: wJackpot?.paid ?? 0,
              jackpotPotsTotal: wJackpot?.potsTotal ?? null,
              jackpotMegaPot: wJackpot?.megaPot ?? null,
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
          jackpot: null,
          moonFirst: null,
          published: false,
          skipped: false,
        }),
        failed: true,
        error: error instanceof Error ? error.message : "failed",
      };
      console.warn("[arcade-highlights] weekly branch failed:", error);
    }
  }

  /* ----- monthly: previous calendar month, 1st of month (or forced) ----- */
  const isMonthStart = now.getUTCDate() === 1;
  if (isMonthStart || opts.forceMonthly) {
    try {
      // Calendar-month snap: Date.UTC normalizes month underflow, so a
      // January run (getUTCMonth() - 1 = -1) correctly covers December of
      // the PRIOR year — the same arithmetic class the daily branch relies
      // on with getUTCDate() - 1. A forced off-monthday run covers the last
      // FULL calendar month, never "the last 30 days".
      const mStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
      const mEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const pStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1),
      );
      const month = mStart.toISOString().slice(0, 7);
      const mSlug = `arcade-monthly-${month}`;

      const [mCounts, pMonthCounts, mWin, mSaves, mCoinFlow, mJackpot, mTop] =
        await Promise.all([
          countRounds(supabase, mStart, mEnd),
          countRounds(supabase, pStart, mStart),
          biggestWin(supabase, mStart, mEnd),
          countStreakSaves(supabase, mStart, mEnd),
          countCoinFlow(supabase, mStart, mEnd),
          jackpotStats(supabase, mStart, mEnd),
          monthTop(supabase, mStart, mEnd),
        ]);
      const mTotal = mCounts.reduce((sum, g) => sum + g.rounds, 0);
      const pMonthTotal = pMonthCounts.reduce((sum, g) => sum + g.rounds, 0);
      const mPlayed = mCounts.filter((g) => g.rounds > 0);
      const mTopGame = mPlayed.length
        ? [...mPlayed].sort((a, b) => b.rounds - a.rounds)[0]
        : null;

      const monthly: NonNullable<ArcadeHighlightsSummary["monthly"]> = {
        month,
        slug: mSlug,
        totalRounds: mTotal,
        priorMonthTotal: pMonthTotal,
        topGame: mTopGame?.game ?? null,
        monthTop: mTop,
        jackpot: mJackpot,
        published: false,
        skipped: false,
        failed: false,
      };
      summary.monthly = monthly;

      if (mTotal === 0) {
        monthly.skipped = true;
        await logChange(
          {
            kind: "data_sync",
            title: `Arcade monthly skipped — no rounds in ${month}`,
            body: `No game rounds were settled in ${month}, so no monthly recap post was published.`,
            payload: { ranAt: new Date().toISOString(), month, skipped: true },
          },
          supabase,
        );
      } else {
        const mArticle = buildArcadeMonthlyArticle({
          month,
          monthStart: mStart.toISOString().slice(0, 10),
          monthEnd: new Date(mEnd.getTime() - 1).toISOString().slice(0, 10),
          roundsByGame: mCounts,
          priorMonthTotal: pMonthTotal,
          biggestWin: mWin,
          streakSaves: mSaves,
          coinFlow: mCoinFlow,
          jackpot: mJackpot,
          monthTop: mTop,
        });
        monthly.published = await createFeaturePost({
          slug: mSlug,
          title: mArticle.title,
          excerpt: mArticle.excerpt,
          content: mArticle.content,
          cover: mTopGame ? `/games/art/${mTopGame.id}.svg` : null,
          tags: ["arcade", "monthly"],
        });

        if (monthly.published && push) {
          // Own collapse tag: the monthly push must not replace the daily or
          // weekly one in the notification tray.
          const url = `/blog/${mSlug}`;
          recordNotification({
            kind: "blog",
            title: mArticle.title,
            body: mArticle.excerpt,
            url,
            tag: "arcade-monthly",
          }).catch(() => undefined);
          sendPushToAll(
            { title: mArticle.title, body: mArticle.excerpt, url, tag: "arcade-monthly" },
            { recapOnly: true },
          ).catch(() => undefined);
        }

        await logChange(
          {
            kind: "data_sync",
            title: monthly.published
              ? `Arcade monthly published for ${month}`
              : `Arcade monthly already recorded for ${month}`,
            body: monthly.published
              ? `Monthly arcade recap for ${month}: ${mTotal} settled rounds${mTopGame ? `, game of the month: ${mTopGame.game}` : ""}${mTop ? `, player of the month: ${mTop.username} (${mTop.rounds} rounds)` : ""}${pMonthTotal > 0 ? `, ${mTotal >= pMonthTotal ? "up" : "down"} on the prior month's ${pMonthTotal}` : ""}. Post at /blog/${mSlug}.`
              : `The monthly recap for ${month} already existed (idempotent re-run).`,
            payload: {
              ranAt: new Date().toISOString(),
              month,
              published: monthly.published,
              totalRounds: mTotal,
              priorMonthTotal: pMonthTotal,
              topGame: monthly.topGame,
              monthTopUser: mTop?.username ?? null,
              monthTopRounds: mTop?.rounds ?? 0,
              chars: mArticle.content.length,
              streakSaves: mSaves,
              coinFlow: mCoinFlow,
              jackpotHits: mJackpot?.hits ?? 0,
              jackpotPaid: mJackpot?.paid ?? 0,
              jackpotPotsTotal: mJackpot?.potsTotal ?? null,
              jackpotMegaPot: mJackpot?.megaPot ?? null,
            },
          },
          supabase,
        );
      }
    } catch (error) {
      // Never fail the daily half: record and move on (weekly doctrine).
      summary.monthly = {
        ...(summary.monthly ?? {
          month: "unknown",
          slug: "unknown",
          totalRounds: 0,
          priorMonthTotal: null,
          topGame: null,
          monthTop: null,
          jackpot: null,
          published: false,
          skipped: false,
        }),
        failed: true,
        error: error instanceof Error ? error.message : "failed",
      };
      console.warn("[arcade-highlights] monthly branch failed:", error);
    }
  }

  return summary;
}
