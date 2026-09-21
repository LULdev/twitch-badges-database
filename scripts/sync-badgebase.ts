import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runBadgebaseSync } = await import("@/lib/syncs/badgebase");
  const { withHeartbeat } = await import("@/lib/health");
  const summary = await withHeartbeat("sync/badgebase", () => runBadgebaseSync());
  console.log("[sync:badgebase]", JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("sync:badgebase failed:", error);
  process.exit(1);
});
