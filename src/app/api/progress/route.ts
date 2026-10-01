import { authUserId } from "@/lib/gamification/session";
import { getProgress, ensureStarterItems } from "@/lib/gamification/xp";
import { levelFromXp } from "@/lib/gamification/levels";
import { isUserBanned } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

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
  // Starter grant rides the HUD touchpoint: the RPC predicate makes this
  // exactly-once no matter how often it runs.
  await ensureStarterItems(userId);
  const admin = createAdminClient();
  const { data: freezeRow } = await admin
    .from("user_items")
    .select("quantity")
    .eq("user_id", userId)
    .eq("item_key", "streak_freeze")
    .maybeSingle();
  return Response.json({
    authenticated: true,
    coins: progress.coins,
    // Every other surface exposes the number; this returned the whole
    // LevelInfo object, so a consumer reading `level` would render an object.
    level: levelFromXp(progress.xp).level,
    loginStreak: progress.login_streak,
    freezes: (freezeRow as { quantity: number } | null)?.quantity ?? 0,
      gameStreak: progress.game_streak,
      bestGameStreak: progress.best_game_streak,
    // Lets the wheel show its used state on load instead of offering a button
    // that can only answer "already spun today".
    wheelSpunToday:
      progress.last_wheel_date === new Date().toISOString().slice(0, 10),
  });
}
