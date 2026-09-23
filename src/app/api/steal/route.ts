import { playerGate } from "@/lib/admin";
import { getFeatures } from "@/lib/settings";
import { attemptSteal } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await playerGate();
  if (!gate.ok) return Response.json({ error: gate.code }, { status: gate.status });
  const userId = gate.userId;
  const features = await getFeatures();
  if (!features.steals) {
    return Response.json({ error: "feature disabled" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { victim?: string } | null;
  if (!body?.victim) return Response.json({ error: "victim required" }, { status: 400 });
  const result = await attemptSteal(userId, body.victim);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
