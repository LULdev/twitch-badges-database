import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runPotatSync } = await import("@/lib/syncs/potat");
  const { withHeartbeat } = await import("@/lib/health");
  const summary = await withHeartbeat("sync/potat", () => runPotatSync());
  console.log("[sync:potat]", JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("sync:potat failed:", error);
  process.exit(1);
});
