import { playerGate } from "@/lib/admin";
import { getFeatures } from "@/lib/settings";
import { playGame, type PlayInput } from "@/lib/gamification/games";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await playerGate();
  if (!gate.ok) return Response.json({ error: gate.code }, { status: gate.status });
  const userId = gate.userId;
  const features = await getFeatures();
  if (!features.games) {
    return Response.json({ error: "feature disabled" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { game?: string; bet?: number; input?: PlayInput }
    | null;
  if (!body?.game || typeof body.bet !== "number") {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  // Defence in depth: the game library already rejects these, but NaN/Infinity
  // and negative values should not reach it from the route layer at all.
  if (!Number.isFinite(body.bet) || body.bet <= 0) {
    return Response.json({ error: "invalid bet" }, { status: 400 });
  }
  const result = await playGame(userId, body.game, body.bet, body.input ?? {});
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
