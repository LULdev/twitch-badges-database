import { authUserId } from "@/lib/gamification/session";
import { attemptSteal } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await authUserId();
  if (!userId) return Response.json({ error: "not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { victim?: string } | null;
  if (!body?.victim) return Response.json({ error: "victim required" }, { status: 400 });
  const result = await attemptSteal(userId, body.victim);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
