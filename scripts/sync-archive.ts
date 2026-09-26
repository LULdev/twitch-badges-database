import { config } from "dotenv";

config({ path: ".env.local" });

// tsx runs this file in CJS mode, so the engine has to be imported dynamically
// after dotenv has populated process.env. The argv flags are read at module
// scope because they are pure — no environment access.
const ARGS = process.argv.slice(2);
const dryRun = ARGS.includes("--dry-run") || ARGS.includes("--dryRun");
const rawLimit = (
  ARGS.find((arg) => arg.startsWith("--limit=")) ?? ""
).slice("--limit=".length);
const limit = /^\d+$/.test(rawLimit.trim())
  ? Number(rawLimit.trim())
  : undefined;

/**
 * Same rule as the cron route: completing with nothing recovered is the
 * incident the heartbeat exists to surface, so it is recorded as degraded.
 * A dry run recovers nothing by design, so that arm does not apply to it.
 */
function degradedReason(summary: unknown): string | null {
  if (!summary || typeof summary !== "object") return null;
  const row = summary as Record<string, unknown>;
  const unavailable = Array.isArray(row.sourcesUnavailable)
    ? row.sourcesUnavailable.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (unavailable.length > 0) {
    return `archive sources unavailable: ${unavailable.join(", ")}`;
  }
  if (dryRun) return null;
  const recovered = typeof row.valuesRecovered === "number" ? row.valuesRecovered : 0;
  const inserted = typeof row.inserted === "number" ? row.inserted : 0;
  const captures = typeof row.capturesFetched === "number" ? row.capturesFetched : 0;
  if (captures > 0 && recovered === 0 && inserted === 0) {
    return "captures fetched but no owner count recovered";
  }
  return null;
}

async function main() {
  // A dry run writes no badge_stats row and no changelog row (the engine owns
  // both), so it is the safe way to validate the whole feature against
  // production. The only write it leaves behind is the heartbeat row.
  const { runArchiveBackfill } = await import("@/lib/syncs/archive");
  const { withHeartbeat } = await import("@/lib/health");
  const summary = await withHeartbeat(
    "sync/archive",
    () => runArchiveBackfill({ dryRun, limit }),
    (result) => result as unknown as Record<string, unknown>,
    (result) => {
      const reason = degradedReason(result);
      return reason
        ? { status: "degraded" as const, message: reason }
        : { status: "ok" as const };
    },
  );
  console.log("[sync:archive]", JSON.stringify(summary, null, 2));
  if (dryRun) console.log("[sync:archive] dry run — nothing was written.");
  const reason = degradedReason(summary);
  if (reason) console.warn("[sync:archive] degraded:", reason);
}

main().catch((error) => {
  console.error("sync:archive failed:", error);
  process.exit(1);
});
