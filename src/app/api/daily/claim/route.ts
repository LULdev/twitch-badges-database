import { playerGate } from "@/lib/admin";
import { claimDaily } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";

export async function POST() {
  const gate = await playerGate();
  if (!gate.ok) return Response.json({ error: gate.code }, { status: gate.status });
  const userId = gate.userId;
  const result = await claimDaily(userId);
  if (!result.ok) return Response.json({ error: "already-claimed-today" }, { status: 429 });
  return Response.json(result);
}
