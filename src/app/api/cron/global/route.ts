import { envOrNull } from "@/lib/env";
import { runGlobalSync } from "@/lib/syncs/global";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = envOrNull("CRON_SECRET");
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Hobby plans allow only 2 daily crons, so this handler runs the catalog
  // diff AND the badgebase drop-window enrichment together.
  let summary: unknown;
  try {
    summary = await runGlobalSync();
  } catch (error) {
    console.error("[cron/global]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }

  let badgebase: unknown = null;
  try {
    badgebase = await runBadgebaseSync();
  } catch (error) {
    console.error("[cron/badgebase]", error);
  }

  return Response.json({ ok: true, summary, badgebase });
}
