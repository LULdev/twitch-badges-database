import { config } from "dotenv";
import { envOrNull } from "@/lib/env";
import { sendPushToAll } from "@/lib/push";

config({ path: ".env.local" });

async function main() {
  const title = process.argv[2];
  const body = process.argv[3] ?? "";
  const url = process.argv[4] ?? "/";
  if (!title) {
    console.error(
      "Usage: npm run send:push -- \"Title\" \"Body\" \"/en/badges/slug\"",
    );
    process.exit(1);
  }
  if (!envOrNull("VAPID_PUBLIC_KEY")) {
    console.error("VAPID keys are not configured in .env.local");
    process.exit(1);
  }
  const result = await sendPushToAll({ title, body, url, tag: "manual" });
  console.log("[send:push]", JSON.stringify(result));
}

main().catch((error) => {
  console.error("send:push failed:", error);
  process.exit(1);
});
