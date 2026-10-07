import { revalidateTag } from "next/cache";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runGlobalSync } from "@/lib/syncs/global";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";
import { runArcadeHighlights } from "@/lib/syncs/arcade-highlights";
import { pruneHeartbeats, recordHeartbeat, withHeartbeat } from "@/lib/health";
import { prunedCoinRainGate } from "@/lib/gamification/daily";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // The catalog moved if either half of the daily sync succeeded — drop the
  // unstable_cache payloads tagged "catalog"/"home" (loadHomeData /
  // loadSiteStats / loadCategories) instead of serving up to 5 minutes of
  // stale rows (a removed badge used to keep rendering until the revalidate
  // window expired). These tags have no other invalidator, and revalidateTag
  // only runs in a request context — which is why this call lives in this
  // route and not in the sync engines.
  if (!globalFailed || !badgebaseFailed) {
    revalidateTag("catalog", "default");
    revalidateTag("home", "default");
  }

  // Daily housekeeping: keep the heartbeat table bounded. The coin-rain gate
  // only ever consults today's rows, so anything older is dead weight. Retention
  // must not be coupled to the least reliable step, so it runs unconditionally —
  // also on the global-failure path, which used to prune but skip the rain gate.
  const pruned = await pruneHeartbeats(90).catch(() => 0);
  const prunedRainGate = await prunedCoinRainGate().catch(() => 0);

  // Ledger-growth probe. steal_attempts is the victim-side coin ledger (the
  // inventory transaction list reads it all-time), NOT gate state like
  // coin_rain_gate — it must never be bulk-pruned, or victims lose their theft
  // history. The daily count recorded in this heartbeat's payload is the
  // growth series to watch for abuse-level spikes; the read fails soft (null)
  // and can never take the cron down. The client construction sits INSIDE the
  // promise chain on purpose: createAdminClient() throws synchronously on
  // missing env, and a bare Promise.resolve(createAdminClient()...) would
  // evaluate that throw before the .catch exists.
  const stealAttempts = await Promise.resolve()
    .then(() =>
      createAdminClient()
        .from("steal_attempts")
        .select("id", { count: "exact", head: true }),
    )
    .then((r) => r.count ?? null)
    .catch(() => null);

  // Daily arcade recap post (previous UTC day). Own heartbeat unit so the
  // status page shows it separately; failures degrade the run but never block
  // the catalog sync above, and a quiet day is a recorded skip, not an error.
  let highlights: unknown = null;
  let highlightsFailed = false;
  let highlightsError: string | null = null;
  try {
    highlights = await withHeartbeat(
      "sync/arcade-highlights",
      () => runArcadeHighlights(),
      (result) => result as unknown as Record<string, unknown>,
      (result) => {
        const r = result as { skipped?: boolean; weekly?: { failed?: boolean } };
        if (r?.weekly?.failed) {
          return { status: "degraded", message: "weekly recap failed" };
        }
        return r?.skipped
          ? { status: "degraded", message: "no rounds — recap skipped" }
          : { status: "ok" };
      },
    );
  } catch (error) {
    console.error("[cron/global] arcade highlights", error);
    highlightsFailed = true;
    highlightsError = error instanceof Error ? error.message : "failed";
  }

  const durationMs = Date.now() - started;
  await recordHeartbeat({
    source: "cron/global",
    status:
      globalFailed || badgebaseFailed || badgebaseSkipped || highlightsFailed
        ? "degraded"
        : "ok",
    durationMs,
    message: globalFailed
      ? (globalError ?? "catalog sync failed")
      : badgebaseFailed
        ? (badgebaseError ?? "drop-window enrichment failed")
        : badgebaseSkipped
          ? "drop-window enrichment skipped"
          : highlightsFailed
            ? (highlightsError ?? "arcade highlights failed")
            : null,
    payload: {
      prunedHeartbeats: pruned,
      prunedRainGate,
      stealAttempts,
      globalFailed,
      badgebaseFailed,
      badgebaseSkipped,
      highlightsFailed,
    },
  });

  // 207 signals a partial failure. A SKIPPED enrichment (the incident guard) is
  // deliberately 200, not 207: the run is healthy, the enrichment did nothing. The only
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
      highlights,
      highlightsFailed,
      highlightsError,
      durationMs,
      pruned,
      prunedRainGate,
      stealAttempts,
    },
    { status },
  );
}
