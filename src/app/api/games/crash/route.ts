import { playerGate } from "@/lib/admin";
import { getFeatures } from "@/lib/settings";
import { cashoutCrash, pollCrashRound, startCrashRound } from "@/lib/gamification/crash";

export const dynamic = "force-dynamic";

/**
 * The Badge Rocket board endpoint — the arcade's only multi-action game
 * route. Every action is player-gated and feature-gated exactly like
 * /api/games/play; the engine (src/lib/gamification/crash.ts) owns every
 * number. The crash point never appears in any response until the flight
 * has ended.
 *
 *   { action: "bet", bet, auto, nonce }  → launch a flight (debits the bet)
 *   { action: "cashout" }                → grade the click from the server clock
 *   { action: "active" }                 → poll / re-attach the live flight
 */
export async function POST(request: Request) {
  const gate = await playerGate();
  if (!gate.ok) return Response.json({ error: gate.code }, { status: gate.status });
  const userId = gate.userId;
  const features = await getFeatures();
  if (!features.games) {
    return Response.json({ error: "feature disabled" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; bet?: number; auto?: number | null; nonce?: string }
    | null;
  if (!body?.action) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  if (body.action === "bet") {
    if (typeof body.bet !== "number" || !Number.isFinite(body.bet) || body.bet <= 0) {
      return Response.json({ error: "invalid bet" }, { status: 400 });
    }
    // Same nonce sanitisation as the play route: a plain short token, only
    // ever matched for exact equality.
    const nonce =
      typeof body.nonce === "string" && body.nonce.length > 0 && body.nonce.length <= 64
        ? body.nonce
        : undefined;
    // auto is optional and bounded server-side too (1.01x .. 250x); anything
    // outside is dropped to "off" rather than rejected — it is a convenience
    // target, never a payout path the client controls.
    const auto =
      typeof body.auto === "number" && Number.isFinite(body.auto) ? body.auto : null;
    const result = await startCrashRound(userId, body.bet, auto, nonce);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "cashout") {
    const result = await cashoutCrash(userId);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "active") {
    const state = await pollCrashRound(userId);
    return Response.json(state);
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
