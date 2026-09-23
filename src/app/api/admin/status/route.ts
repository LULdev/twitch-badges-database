import { adminAction } from "@/lib/admin-route";
import { runLiveProbes } from "@/lib/analytics";
import { getPlatformStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/status — recorded heartbeat history plus a live probe.
 *
 * The probes are taken per request and never cached: the whole point of the
 * status tab is to answer "is it up right now", and a cached answer is exactly
 * what the heartbeat table already provides.
 */
export async function GET(request: Request) {
  return adminAction(async () => {
    const [platform, probes] = await Promise.all([
      getPlatformStats().catch(() => null),
      runLiveProbes(),
    ]);
    return {
      sources: platform?.uptime?.sources ?? [],
      probes,
      checkedAt: new Date().toISOString(),
    };
  }, request);
}
