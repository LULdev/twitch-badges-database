import { playerGate } from "@/lib/admin";
import { getFeatures } from "@/lib/settings";
import { spinWheel } from "@/lib/gamification/wheel";

export const dynamic = "force-dynamic";

export async function POST() {
  // Wave A: the auth/ban gate and the feature-flag read in flight together.
  // What MUST stay serial is the mutation: `spinWheel` writes (gate RPC,
  // jackpot insert, award), so it is not started until the ban check below has
  // resolved — a banned or anonymous request writes nothing. `getFeatures` is a
  // 5 s-cached read (settings.ts) that writes nothing and cannot reject
  // (readSetting catches), so it may run alongside the gate; the checks keep
  // their original order, so the 401 / 403-banned / 403-disabled response
  // surface is unchanged.
  const [gate, features] = await Promise.all([playerGate(), getFeatures()]);
  // `code` mirrors `error` so the client can map the gate failures through the
  // locale files instead of rendering the raw English string.
  if (!gate.ok) {
    return Response.json({ error: gate.code, code: gate.code }, { status: gate.status });
  }
  const userId = gate.userId;
  if (!features.wheel) {
    return Response.json({ error: "feature disabled", code: "disabled" }, { status: 403 });
  }
  const result = await spinWheel(userId);
  if (!result.ok) return Response.json({ error: "already-spun-today" }, { status: 429 });
  return Response.json(result.result);
}
