import { createAdminClient } from "./supabase/admin";

export type HeartbeatSource =
  | "sync/global"
  | "sync/badgebase"
  | "sync/potat"
  | "cron/global"
  | "cron/potat"
  | "cron/badgebase"
  | "web";

export type HeartbeatStatus = "ok" | "degraded" | "error";

export interface HeartbeatEntry {
  source: HeartbeatSource;
  status?: HeartbeatStatus;
  durationMs?: number | null;
  message?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Append one observability row. Heartbeat writes must never break the caller
 * (a failed sync should still surface its own error, not a logging error),
 * so failures are only warned about.
 */
export async function recordHeartbeat(entry: HeartbeatEntry): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("system_heartbeats").insert({
      source: entry.source,
      status: entry.status ?? "ok",
      duration_ms: entry.durationMs ?? null,
      message: entry.message ?? null,
      payload: entry.payload ?? null,
    });
    if (error) throw error;
  } catch (error) {
    console.warn("[heartbeat] write failed:", error);
  }
}

/**
 * Time a sync/health unit and record exactly one heartbeat for it —
 * "ok" on success, "error" with the message on failure. The error is
 * re-thrown so the caller's own error handling stays intact.
 */
export async function withHeartbeat<T>(
  source: HeartbeatSource,
  run: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown> | null,
  /**
   * A run can finish without failing and still have achieved nothing (the
   * drop-window sync skips when its listing comes back empty). Without this the
   * heartbeat recorded "ok" and the uptime view stayed green through the very
   * incident the caller wanted to surface.
   */
  statusOf?: (result: T) => { status: "ok" | "degraded"; message?: string | null },
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    const outcome = statusOf?.(result);
    await recordHeartbeat({
      source,
      status: outcome?.status ?? "ok",
      durationMs: Date.now() - started,
      message: outcome?.message ?? null,
      payload: summarize ? summarize(result) : null,
    });
    return result;
  } catch (error) {
    await recordHeartbeat({
      source,
      status: "error",
      durationMs: Date.now() - started,
      message: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Human-readable message for anything that can be thrown. Supabase returns its
 * errors as plain objects, and `String(error)` on one of those produced the
 * literal "[object Object]" — which the public /stats page then displayed as the
 * reason a sync had failed.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; details?: unknown; code?: unknown };
    if (typeof candidate.message === "string" && candidate.message) {
      return typeof candidate.code === "string"
        ? `${candidate.message} (${candidate.code})`
        : candidate.message;
    }
    if (typeof candidate.details === "string" && candidate.details) {
      return candidate.details;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown error";
    }
  }
  return String(error);
}

/** Keep the heartbeat table bounded — called from the daily global cron. */
export async function pruneHeartbeats(olderThanDays = 90): Promise<number> {
  try {
    const supabase = createAdminClient();
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("system_heartbeats")
      .delete()
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  } catch (error) {
    console.warn("[heartbeat] prune failed:", error);
    return 0;
  }
}
