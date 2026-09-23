import { gateResponse, requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_ACHIEVEMENTS, ACHIEVEMENTS } from "@/lib/gamification/achievements";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users/achievements?userId=
 *
 * Returns the full catalog (with the display metadata a picker needs — the
 * self-evaluating `check` function is not serializable and is dropped) plus the
 * ids the given member has unlocked. Without `userId` only the catalog is
 * returned, so the grant UI can render before a member is selected.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const userId = new URL(request.url).searchParams.get("userId");

    const catalog = ACHIEVEMENTS.map((ach) => ({
      id: ach.id,
      category: ach.category,
      title: ach.title,
      description: ach.description,
      points: ach.points,
      xp: ach.xp,
      coins: ach.coins,
      active: ACTIVE_ACHIEVEMENTS.some((entry) => entry.id === ach.id),
    }));

    let unlocked: string[] = [];
    if (userId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("user_achievements")
        .select("achievement_id")
        .eq("user_id", userId);
      unlocked = (data ?? []).map((row) => row.achievement_id as string);
    }

    return Response.json({ catalog, unlocked });
  } catch (error) {
    return gateResponse(error);
  }
}