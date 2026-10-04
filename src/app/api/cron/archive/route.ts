import { isAuthorizedCron } from "@/lib/cron-auth";
import { runArchiveBackfill } from "@/lib/syncs/archive";
import { recordHeartbeat, withHeartbeat } from "@/lib/health";

export const dynamic = "force-dynamic";
// The backfill is a one-time recovery pass and a full catalog sweep does not fit
// in 60 s of serverless time. This route exists for parity with the other crons
// and for small targeted runs (?limit=N); scripts/sync-archive.ts is the real
// entry point and the only one meant to sweep the catalog.
export const maxDuration = 60;

/**
 * A run can finish cleanly and have recovered nothing. That is the incident the
 * heartbeat exists to surface, so it must not be recorded as "ok": an archive
 * source that is entirely unreachable, or captures that were fetched but yielded
 * no owner count, both mean the curve was not extended.
 *
 * `valuesRecovered` is expected to be 0 on a dry run by design, so the
 * "found but recovered nothing" arm is skipped there — otherwise every healthy
 * dry run would paint the uptime view degraded.
 */
function degradedReason(summary: unknown, dryRun: boolean): string | null {
  if (!summary || typeof summary !== "object") return null;
  const row = summary as Record<string, unknown>;
  const unavailable = Array.isArray(row.sourcesUnavailable)
    ? row.sourcesUnavailable.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (unavailable.length > 0) {
    return `archive sources unavailable: ${unavailable.join(", ")}`;
  }
  if (dryRun) return null;
  const recovered =
    typeof row.valuesRecovered === "number" ? row.valuesRecovered : 0;
  const inserted = typeof row.inserted === "number" ? row.inserted : 0;
  const captures = typeof row.capturesFetched === "number" ? row.capturesFetched : 0;
  if (captures > 0 && recovered === 0 && inserted === 0) {
    return "captures fetched but no owner count recovered";
  }
  return null;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // A hand-typed limit must never reach the engine as NaN: `--limit=abc` in a
  // shell is a normal typo, and an unvalidated NaN would page the catalog with a
  // broken range. Anything non-numeric, negative or empty falls back to the
  // engine default by simply not passing the option.
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1" || params.get("dryRun") === "true";
  const rawLimit = (params.get("limit") ?? "").trim();
  const limit = /^\d+$/.test(rawLimit) && Number(rawLimit) > 0 ? Number(rawLimit) : undefined;

  const started = Date.now();
  try {
    // runArchiveBackfill survives an individual source being down and resolves
    // normally, so the summary is passed through and the degraded outcome derived
    // from it — the same shape /api/cron/potat uses.
    const summary = await withHeartbeat(
      "sync/archive",
      () => runArchiveBackfill({ dryRun, limit }),
      (result) => result as unknown as Record<string, unknown>,
      (result) => {
        const reason = degradedReason(result, dryRun);
        return reason
          ? { status: "degraded" as const, message: reason }
          : { status: "ok" as const };
      },
    );
    const durationMs = Date.now() - started;
    const reason = degradedReason(summary, dryRun);
    await recordHeartbeat({
      source: "cron/archive",
      status: reason ? "degraded" : "ok",
      durationMs,
      message: reason,
    });
    // Still 200: the run completed and wrote nothing it should not have, and a
    // missing archive source is a degraded outcome, not a route failure. No
    // GitHub Actions workflow asserts on this route's status code.
    return Response.json({ ok: true, summary, dryRun, limit: limit ?? null, durationMs });
  } catch (error) {
    const durationMs = Date.now() - started;
    await recordHeartbeat({
      source: "cron/archive",
      status: "error",
      durationMs,
      message: error instanceof Error ? error.message : "failed",
    });
    console.error("[cron/archive]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
