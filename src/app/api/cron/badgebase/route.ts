import { isAuthorizedCron } from "@/lib/cron-auth";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";
import { recordHeartbeat, withHeartbeat } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    // The summary is passed through so a deliberate skip is visible here too:
    // this route used to report "ok" for a run that did nothing.
    const summary = await withHeartbeat(
      "sync/badgebase",
      () => runBadgebaseSync(),
      (result) => result as unknown as Record<string, unknown>,
    );
    const skipped = typeof (summary as { skipped?: string }).skipped === "string";
    const durationMs = Date.now() - started;
    await recordHeartbeat({
      source: "cron/badgebase",
      status: skipped ? "degraded" : "ok",
      durationMs,
      message: skipped ? "drop-window enrichment skipped: empty listing" : null,
    });
    return Response.json({ ok: true, skipped, summary, durationMs });
  } catch (error) {
    const durationMs = Date.now() - started;
    await recordHeartbeat({
      source: "cron/badgebase",
      status: "error",
      durationMs,
      message: error instanceof Error ? error.message : "failed",
    });
    console.error("[cron/badgebase]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
