import { isAuthorizedCron } from "@/lib/cron-auth";
import { runPotatSync } from "@/lib/syncs/potat";
import { recordHeartbeat, withHeartbeat } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    // runPotatSync deliberately survives an owners-feed outage and resolves
    // normally, so the summary is passed through and a degraded outcome derived
    // from it — the same shape /api/cron/global and /api/cron/badgebase use.
    const summary = await withHeartbeat(
      "sync/potat",
      () => runPotatSync(),
      (result) => result as unknown as Record<string, unknown>,
      (result) =>
        result.ownersFeedOk === false
          ? { status: "degraded" as const, message: "owner feed unavailable" }
          : { status: "ok" as const },
    );
    const durationMs = Date.now() - started;
    const degraded = summary.ownersFeedOk === false;
    await recordHeartbeat({
      source: "cron/potat",
      status: degraded ? "degraded" : "ok",
      durationMs,
      message: degraded ? "owner feed unavailable" : null,
    });
    // Still 200: the run completed and kept the stored counts, and the GitHub
    // Actions workflow that calls this route asserts a 200.
    return Response.json({ ok: true, summary, durationMs });
  } catch (error) {
    const durationMs = Date.now() - started;
    await recordHeartbeat({
      source: "cron/potat",
      status: "error",
      durationMs,
      message: error instanceof Error ? error.message : "failed",
    });
    console.error("[cron/potat]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
