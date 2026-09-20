import { authUserId } from "@/lib/gamification/session";
import { claimDaily } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await authUserId();
  if (!userId) return Response.json({ error: "not authenticated" }, { status: 401 });
  const result = await claimDaily(userId);
  if (!result.ok) return Response.json({ error: "already-claimed-today" }, { status: 429 });
  return Response.json(result);
}
