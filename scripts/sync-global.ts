import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runGlobalSync } = await import("@/lib/syncs/global");
  const summary = await runGlobalSync();
  console.log("[sync:global]", JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("sync:global failed:", error);
  process.exit(1);
});
