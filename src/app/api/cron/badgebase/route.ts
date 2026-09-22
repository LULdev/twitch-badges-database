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
    const summary = await withHeartbeat("sync/badgebase", () => runBadgebaseSync());
    const durationMs = Date.now() - started;
    await recordHeartbeat({ source: "cron/badgebase", status: "ok", durationMs });
    return Response.json({ ok: true, summary, durationMs });
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
