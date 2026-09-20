import { authUserId } from "@/lib/gamification/session";
import { coinRain } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { profileId?: string } | null;
  if (!body?.profileId) return Response.json({ error: "profileId required" }, { status: 400 });
  const giverId = await authUserId();
  const result = await coinRain(giverId, body.profileId);
  if (!result.ok) return Response.json({ ok: false, already: true }, { status: 200 });
  return Response.json({ ok: true });
}
