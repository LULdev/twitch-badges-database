/**
 * Manual trigger for the daily arcade-highlights post (same engine the 06:00
 * UTC global cron runs; the weekly recap only fires on Mondays unless
 * forced). Idempotent by the date-stamped slug.
 *
 *   npm run sync:highlights                # publish for yesterday (+ push)
 *   npm run sync:highlights -- --no-push   # publish without push/notification
 *   npm run sync:highlights -- --dry       # aggregate + print, write nothing
 *   npm run sync:highlights -- --weekly    # force the weekly branch (any day)
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const noPush = args.includes("--no-push");
  const weekly = args.includes("--weekly");

  if (dry) {
    // Dry mode imports the pieces directly so nothing is written: no post,
    // no changelog, no heartbeat.
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { GAMES } = await import("@/lib/gamification/games");
    const { buildArcadeHighlightsArticle } = await import("@/lib/blog");
    const supabase = createAdminClient();
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const counts = await Promise.all(
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
    const { data: winRow } = await supabase
      .from("game_rounds")
      .select("game,user_id,bet,payout")
      .eq("won", true)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("payout", { ascending: false })
      .limit(1)
      .maybeSingle();
    const win = winRow as { game: string; user_id: string; bet: number; payout: number } | null;
    let biggestWin = null;
    if (win) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", win.user_id)
        .maybeSingle();
      biggestWin = {
        id: GAMES.find((g) => g.id === win.game)?.id ?? win.game,
        game: GAMES.find((g) => g.id === win.game)?.title ?? win.game,
        bet: win.bet,
        payout: win.payout,
        username: (profile as { username: string | null } | null)?.username ?? null,
      };
    }
    const article = buildArcadeHighlightsArticle({
      day: start.toISOString().slice(0, 10),
      roundsByGame: counts,
      biggestWin,
    });
    console.log("=== DRY — nothing written ===");
    console.log("title:", article.title);
    console.log("excerpt:", article.excerpt);
    console.log("content chars:", article.content.length, "(floor 600)");
    console.log(counts.filter((c) => c.rounds > 0));
    if (biggestWin) console.log("biggest win:", biggestWin);
    return;
  }

  const { runArcadeHighlights } = await import("@/lib/syncs/arcade-highlights");
  const { withHeartbeat } = await import("@/lib/health");
  const summary = await withHeartbeat("manual/arcade-highlights", () =>
    runArcadeHighlights({ push: !noPush, forceWeekly: weekly }),
  );
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
