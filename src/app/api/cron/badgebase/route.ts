import { envOrNull } from "@/lib/env";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = envOrNull("CRON_SECRET");
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runBadgebaseSync();
    return Response.json({ ok: true, summary });
  } catch (error) {
    console.error("[cron/badgebase]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
