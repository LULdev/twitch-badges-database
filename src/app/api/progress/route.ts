import { authUserId } from "@/lib/gamification/session";
import { getProgress } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";
import { isUserBanned } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Own progress summary for the header HUD. */
export async function GET() {
  const userId = await authUserId();
  if (!userId) return Response.json({ authenticated: false });
  // `getProgress` below INSERTS a row on miss, so this is a mutating route: a
  // banned member is stopped here like every other mutation (see admin.ts).
  if (await isUserBanned(userId)) {
    return Response.json({ error: "banned" }, { status: 403 });
  }
  const progress = await getProgress(userId);
  return Response.json({
    authenticated: true,
    coins: progress.coins,
    // Every other surface exposes the number; this returned the whole
    // LevelInfo object, so a consumer reading `level` would render an object.
    level: levelFromXp(progress.xp).level,
    loginStreak: progress.login_streak,
    // Lets the wheel show its used state on load instead of offering a button
    // that can only answer "already spun today".
    wheelSpunToday:
      progress.last_wheel_date === new Date().toISOString().slice(0, 10),
  });
}
