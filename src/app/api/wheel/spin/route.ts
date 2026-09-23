import { playerGate } from "@/lib/admin";
import { getFeatures } from "@/lib/settings";
import { spinWheel } from "@/lib/gamification/wheel";

export const dynamic = "force-dynamic";

export async function POST() {
  const gate = await playerGate();
  if (!gate.ok) return Response.json({ error: gate.code }, { status: gate.status });
  const userId = gate.userId;
  const features = await getFeatures();
  if (!features.wheel) {
    return Response.json({ error: "feature disabled" }, { status: 403 });
  }
  const result = await spinWheel(userId);
  if (!result.ok) return Response.json({ error: "already-spun-today" }, { status: 429 });
  return Response.json(result.result);
}
