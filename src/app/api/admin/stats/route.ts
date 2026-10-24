import { adminAction } from "@/lib/admin-route";
import { getAnalytics } from "@/lib/analytics";
import { getPlatformStats } from "@/lib/stats";
import { getAdminPlayerEconomy } from "@/lib/admin-users";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats — the visitor analytics plus the platform counters the
 * public dashboard already reads, in one payload so the tab renders from a
 * single request.
 */
export async function GET(request: Request) {
  return adminAction(async () => {
    const [analytics, platform, playerEconomy] = await Promise.all([
      getAnalytics(),
      getPlatformStats().catch(() => null),
      getAdminPlayerEconomy().catch(() => []),
    ]);
    return {
      ...analytics,
      playerEconomy,
      platform: platform
        ? {
            gamification: platform.gamification,
            traffic: platform.traffic,
            system: platform.system,
            uptime: platform.uptime,
          }
        : null,
    };
  }, request);
}