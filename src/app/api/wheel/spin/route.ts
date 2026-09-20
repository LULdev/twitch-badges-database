import { authUserId } from "@/lib/gamification/session";
import { spinWheel } from "@/lib/gamification/wheel";

export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await authUserId();
  if (!userId) return Response.json({ error: "not authenticated" }, { status: 401 });
  const result = await spinWheel(userId);
  if (!result.ok) return Response.json({ error: "already-spun-today" }, { status: 429 });
  return Response.json(result.result);
}
