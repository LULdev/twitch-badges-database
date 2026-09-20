import { authUserId } from "@/lib/gamification/session";
import { getProgress } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";

export const dynamic = "force-dynamic";

/** Own progress summary for the header HUD. */
export async function GET() {
  const userId = await authUserId();
  if (!userId) return Response.json({ authenticated: false });
  const progress = await getProgress(userId);
  return Response.json({
    authenticated: true,
    coins: progress.coins,
    level: levelFromXp(progress.xp),
    loginStreak: progress.login_streak,
  });
}
