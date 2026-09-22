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
    // Lets the wheel show its used state on load instead of offering a button
    // that can only answer "already spun today".
    wheelSpunToday:
      progress.last_wheel_date === new Date().toISOString().slice(0, 10),
  });
}
