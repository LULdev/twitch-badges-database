import { isAuthorizedCron } from "@/lib/cron-auth";
import { runGlobalSync } from "@/lib/syncs/global";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";
import { pruneHeartbeats, recordHeartbeat, withHeartbeat } from "@/lib/health";
import { prunedCoinRainGate } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";
// One 60 s ceiling covers BOTH halves (Hobby allows no more). The engines are
// budgeted to fit — badgebase's detail pass is capped at 24 fetches / 6 at a time
// / 8 s each (≤32 s) — and `.github/workflows/badgebase-sync.yml` triggers
// /api/cron/badgebase independently, so a run killed here still gets its
// authoritative half done.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // Hobby plans allow only 2 daily crons, so this handler runs the catalog
  // diff AND the badgebase drop-window enrichment together. Both halves run
  // even when the other fails: a provider incident on the Twitch feed used to
  // return 500 before the badgebase enrichment, freezing the authoritative
  // activity state — the part badgebase alone can still refresh — for a day.
  let summary: unknown = null;
  let globalFailed = false;
  let globalError: string | null = null;
  try {
    summary = await withHeartbeat("sync/global", () => runGlobalSync());
  } catch (error) {
    console.error("[cron/global]", error);
    globalFailed = true;
    globalError = error instanceof Error ? error.message : "failed";
  }

  // An explicit flag rather than the truthiness of the return value: a
  // legitimate no-op result (e.g. an empty catalog) would otherwise be recorded
  // as a failure and pollute the uptime view with false "degraded" rows.
  let badgebase: unknown = null;
  let badgebaseFailed = false;
  let badgebaseSkipped = false;
  let badgebaseError: string | null = null;
  try {
    // The summary is passed through to the heartbeat: a run that deliberately
    // did nothing is not a success, and without this the payload carried no
    // trace of it.
    badgebase = await withHeartbeat(
      "sync/badgebase",
      () => runBadgebaseSync(),
    (result) => result as unknown as Record<string, unknown>,
    (result) =>
      typeof (result as { skipped?: string }).skipped === "string"
        ? {
            status: "degraded",
            message: "drop-window enrichment skipped",
          }
        : { status: "ok" },
    );
    badgebaseSkipped =
      typeof (badgebase as { skipped?: string }).skipped === "string";
  } catch (error) {
    console.error("[cron/badgebase]", error);
    badgebaseFailed = true;
    badgebaseError = error instanceof Error ? error.message : "failed";
  }

  // Daily housekeeping: keep the heartbeat table bounded. The coin-rain gate
  // only ever consults today's rows, so anything older is dead weight. Retention
  // must not be coupled to the least reliable step, so it runs unconditionally —
  // also on the global-failure path, which used to prune but skip the rain gate.
  const pruned = await pruneHeartbeats(90).catch(() => 0);
  const prunedRainGate = await prunedCoinRainGate().catch(() => 0);

  const durationMs = Date.now() - started;
  await recordHeartbeat({
    source: "cron/global",
    status: globalFailed || badgebaseFailed || badgebaseSkipped ? "degraded" : "ok",
    durationMs,
    message: globalFailed
      ? (globalError ?? "catalog sync failed")
      : badgebaseFailed
        ? (badgebaseError ?? "drop-window enrichment failed")
        : badgebaseSkipped
          ? "drop-window enrichment skipped"
          : null,
    payload: {
      prunedHeartbeats: pruned,
      prunedRainGate,
      globalFailed,
      badgebaseFailed,
      badgebaseSkipped,
    },
  });

  // 207 signals a partial success: exactly one half failed (or the enrichment
  // deliberately did nothing). 500 is reserved for both halves failing. The only
  // consumer that inspects a cron status code is the potat GitHub workflow, which
  // hits a different route; Vercel cron ignores it.
  const status =
    globalFailed && badgebaseFailed ? 500 : globalFailed || badgebaseFailed ? 207 : 200;
  return Response.json(
    {
      ok: !globalFailed && !badgebaseFailed,
      summary,
      globalFailed,
      globalError,
      badgebase,
      badgebaseFailed,
      badgebaseSkipped,
      durationMs,
      pruned,
      prunedRainGate,
    },
    { status },
  );
}
