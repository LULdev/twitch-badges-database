import { createAdminClient } from "@/lib/supabase/admin";
import { logChange } from "@/lib/changelog";

/**
 * Nightly retention for the badge_stats time series (0068).
 *
 * The potat sync appends up to one measured point per badge per hour, so the
 * raw table grows without bound while the owner-trend chart only ever reads
 * the newest ~250 points. `rollup_badge_stats` collapses everything older
 * than the retention window into one row per (badge, UTC day) in
 * badge_stats_daily and deletes the raw rows behind it — idempotently (the
 * delete only fires where the daily row already exists), so a killed run
 * simply finishes on the next night.
 *
 * Archive rows are untouched: they are the sparse one-time recovery series,
 * and the archive backfill's "strictly before the measured era" floor
 * considers badge_stats_daily too (see syncs/archive.ts).
 */

export interface RollupResult {
  /** Daily rows inserted by THIS pass (conflict-skipped days don't count). */
  dailyRows: number;
  /** Raw measured points deleted by THIS pass. */
  rawDeleted: number;
}

export async function runBadgeStatsRollup(keepDays = 14): Promise<RollupResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("rollup_badge_stats", {
    p_keep_days: keepDays,
  });
  if (error) throw error;
  // RPCs returning TABLE arrive wrapped in an array; bigints arrive as strings.
  const row = (
    Array.isArray(data) ? data[0] : data
  ) as { out_daily_rows: string | number; out_raw_deleted: string | number } | null;
  const result: RollupResult = {
    dailyRows: Number(row?.out_daily_rows ?? 0),
    rawDeleted: Number(row?.out_raw_deleted ?? 0),
  };

  // A pass that rolled nothing is a healthy no-op, not a mutation — it logs
  // only when data actually moved, the same cut the potat engine makes
  // between "0 stats points" and a completed sync.
  if (result.dailyRows > 0 || result.rawDeleted > 0) {
    await logChange(
      {
        kind: "data_sync",
        title: "Badge stats rolled up",
        body: `Nightly retention: ${result.dailyRows} daily aggregate rows written to badge_stats_daily and ${result.rawDeleted} raw measured points (older than ${keepDays} days) deleted. The owner-trend chart now reads the daily rows for anything older than the raw window, so nothing visible was lost.`,
        payload: { ranAt: new Date().toISOString(), ...result, keepDays },
      },
      supabase,
    );
  }
  return result;
}
