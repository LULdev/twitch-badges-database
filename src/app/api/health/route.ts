import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health";
import { envOrNull } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const STARTED_AT = Date.now();

/**
 * The endpoint is public and unauthenticated, so it must not write a row per
 * call: a flood would grow `system_heartbeats` without bound and skew the
 * availability figures the /stats page derives from it. One row per minute per
 * instance is plenty for an uptime signal.
 */
let lastHeartbeatAt = 0;
const HEARTBEAT_MIN_INTERVAL_MS = 60_000;

/**
 * Public health probe. Returns live service metrics and records a `web`
 * heartbeat, which is what feeds the availability section on /stats.
 * Deliberately unauthenticated: it exposes no secrets, only timings.
 */
export async function GET() {
  const started = Date.now();
  const supabase = createAdminClient();

  let dbOk = false;
  let dbLatencyMs: number | null = null;
  let catalogTotal: number | null = null;
  let catalogLastSeen: string | null = null;
  let error: string | null = null;

  const dbStarted = Date.now();
  try {
    const { count, error: dbError } = await supabase
      .from("badges")
      .select("id", { count: "exact", head: true });
    if (dbError) throw dbError;
    dbLatencyMs = Date.now() - dbStarted;
    catalogTotal = count ?? 0;
    dbOk = true;

    const { data } = await supabase
      .from("badges")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    catalogLastSeen = data?.last_seen_at ?? null;
  } catch (caught) {
    dbLatencyMs = Date.now() - dbStarted;
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const totalMs = Date.now() - started;
  const status = dbOk && totalMs < 2000 ? "ok" : dbOk ? "degraded" : "error";

  const now = Date.now();
  if (now - lastHeartbeatAt >= HEARTBEAT_MIN_INTERVAL_MS) {
    lastHeartbeatAt = now;
    await recordHeartbeat({
      source: "web",
      status,
      durationMs: totalMs,
      message: error,
      payload: {
        dbLatencyMs,
        catalogTotal,
        catalogLastSeen,
        region: envOrNull("VERCEL_REGION"),
      },
    });
  }

  return Response.json(
    {
      ok: dbOk,
      status,
      checkedAt: new Date().toISOString(),
      responseMs: totalMs,
      db: { ok: dbOk, latencyMs: dbLatencyMs, error },
      catalog: { total: catalogTotal, lastSeenAt: catalogLastSeen },
      runtime: {
        region: envOrNull("VERCEL_REGION") ?? "local",
        environment: envOrNull("VERCEL_ENV") ?? "development",
        node: process.version,
        // Process uptime of this (serverless) instance, in seconds.
        instanceUptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      },
    },
    {
      status: dbOk ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
