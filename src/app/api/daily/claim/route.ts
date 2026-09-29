import { playerGate } from "@/lib/admin";
import { claimDaily } from "@/lib/gamification/daily";
import { getEconomy } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST() {
  // Wave A: the auth/ban gate and the economy read in flight together.
  // What MUST stay serial is the mutation: `claimDaily` writes (ensureProgress
  // upsert, claim_daily_gate RPC, award), so it is not started until the ban
  // check below has resolved — a banned or anonymous request writes nothing.
  // `getEconomy` is a 5 s-cached read (settings.ts) that writes nothing and
  // cannot reject, so it may run alongside the gate; the check order is
  // unchanged.
  const [gate, economy] = await Promise.all([playerGate(), getEconomy()]);
  if (!gate.ok) return Response.json({ error: gate.code }, { status: gate.status });
  const userId = gate.userId;
  const result = await claimDaily(userId, economy);
  if (!result.ok) return Response.json({ error: "already-claimed-today" }, { status: 429 });
  return Response.json(result);
}
