import { playerGate } from "@/lib/admin";
import { buyFreeze } from "@/lib/gamification/items";

export const dynamic = "force-dynamic";

const ITEMS = ["streak_freeze"] as const;

/** Purchase one inventory item for coins. The price comes from the economy
 *  settings server-side; the client sends only the item key. */
export async function POST(request: Request) {
  const gate = await playerGate();
  if (!gate.ok) {
    return Response.json({ error: gate.code }, { status: gate.status });
  }
  const body = (await request.json().catch(() => null)) as { item?: string } | null;
  if (!body?.item || !ITEMS.includes(body.item as (typeof ITEMS)[number])) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  if (body.item === "streak_freeze") {
    const result = await buyFreeze(gate.userId);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  return Response.json({ error: "invalid payload" }, { status: 400 });
}
