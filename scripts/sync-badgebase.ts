import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runBadgebaseSync } = await import("@/lib/syncs/badgebase");
  const { withHeartbeat } = await import("@/lib/health");
  // Same treatment as the cron routes: the summary reaches the heartbeat, so a
  // skipped run (empty /active listing) is not recorded as healthy.
  const summary = await withHeartbeat(
    "sync/badgebase",
    () => runBadgebaseSync(),
    (result) => result as unknown as Record<string, unknown>,
    (result) =>
      typeof (result as { skipped?: string }).skipped === "string"
        ? {
            status: "degraded" as const,
            message: "drop-window enrichment skipped: empty listing",
          }
        : { status: "ok" as const },
  );
  console.log("[sync:badgebase]", JSON.stringify(summary, null, 2));
  if (typeof (summary as { skipped?: string }).skipped === "string") {
    console.warn("[sync:badgebase] skipped:", (summary as { skipped?: string }).skipped);
  }
}

main().catch((error) => {
  console.error("sync:badgebase failed:", error);
  process.exit(1);
});
