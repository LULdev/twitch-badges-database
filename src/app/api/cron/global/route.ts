import { isAuthorizedCron } from "@/lib/cron-auth";
import { runGlobalSync } from "@/lib/syncs/global";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";
import { pruneHeartbeats, recordHeartbeat, withHeartbeat } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // Hobby plans allow only 2 daily crons, so this handler runs the catalog
  // diff AND the badgebase drop-window enrichment together.
  let summary: unknown;
  try {
    summary = await withHeartbeat("sync/global", () => runGlobalSync());
  } catch (error) {
    console.error("[cron/global]", error);
    // Retention must not be coupled to the least reliable step: the prune used
    // to sit after this early return, so a failing catalog sync also stopped
    // the heartbeat table from ever being trimmed.
    await pruneHeartbeats(90).catch(() => 0);
    await recordHeartbeat({
      source: "cron/global",
      status: "error",
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : "failed",
    });
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }

  let badgebase: unknown = null;
  try {
    badgebase = await withHeartbeat("sync/badgebase", () => runBadgebaseSync());
  } catch (error) {
    console.error("[cron/badgebase]", error);
  }

  // Daily housekeeping: keep the heartbeat table bounded.
  const pruned = await pruneHeartbeats(90);

  const durationMs = Date.now() - started;
  await recordHeartbeat({
    source: "cron/global",
    status: badgebase ? "ok" : "degraded",
    durationMs,
    message: badgebase ? null : "badgebase enrichment failed",
    payload: { prunedHeartbeats: pruned },
  });

  // 207 signals a partial success: the catalog diff succeeded but the
  // enrichment half failed. A plain 200 hid that from anything watching the
  // status code, and a 5xx would have wrongly marked the whole run as failed.
  return Response.json({
    ok: badgebase ? true : false,
    summary,
    badgebase,
    // Explicit rather than implied by a null field: the run is a success, but
    // the operator should see that the enrichment half failed.
    badgebaseFailed: !badgebase,
    durationMs,
    pruned,
  }, { status: badgebase ? 200 : 207 });
}
