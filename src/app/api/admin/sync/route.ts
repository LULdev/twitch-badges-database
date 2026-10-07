import { revalidateTag } from "next/cache";
import { adminAction } from "@/lib/admin-route";
import { runGlobalSync } from "@/lib/syncs/global";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";
import { runPotatSync } from "@/lib/syncs/potat";
import { withHeartbeat } from "@/lib/health";
import { audit, roleRank } from "@/lib/admin";

export const dynamic = "force-dynamic";
/** The catalog diff plus enrichment takes a little over half a minute. */
export const maxDuration = 120;

const TARGETS = ["global", "badgebase", "potat"] as const;
type Target = (typeof TARGETS)[number];

/**
 * Ad-hoc sync triggers for the dashboard. These are the same engines the daily
 * crons call — deliberately, so a manual run and a scheduled run cannot drift.
 *
 * The run is wrapped in withHeartbeat under a `manual/...` source: a human
 * pressing the button should show up in uptime history as its own row rather
 * than being indistinguishable from the scheduled job (or worse, overwriting
 * the scheduled row's timing).
 */
export async function POST(request: Request) {
  return adminAction(async (ctx, _url, body) => {
    // The same boundary the settings and newsletter routes state: reaching this
    // route and being allowed to run it are different questions. `requireAdmin()`
    // admits moderators by design, and these engines run with the service role —
    // so a moderator could rewrite every badge, run the global diff or trigger the
    // potat sweep, none of which is content moderation.
    if (roleRank(ctx.role) < roleRank("admin")) {
      return { error: "forbidden: running a sync requires an administrator" };
    }
    const target = String(body?.target ?? "") as Target;
    if (!TARGETS.includes(target)) {
      return { error: "unknown sync target" };
    }

    const started = Date.now();
    try {
      const summary =
        target === "global"
          ? await withHeartbeat("manual/global", () => runGlobalSync())
          : target === "badgebase"
            ? await withHeartbeat("manual/badgebase", () => runBadgebaseSync())
            : await withHeartbeat("manual/potat", () => runPotatSync());
      await audit(ctx, `sync.${target}`, "manual", {
        durationMs: Date.now() - started,
      });
      // A manual run changes the same rows the crons do — drop the cached
      // "catalog"/"home" payloads (loadHomeData, loadSiteStats, loadCategories)
      // so the dashboard's own sync button does not leave the site serving a
      // 5-minute-stale snapshot. Request context is guaranteed here.
      revalidateTag("catalog", "default");
      revalidateTag("home", "default");
      return { ok: true, target, durationMs: Date.now() - started, summary };
    } catch (error) {
      // The failure is returned, not thrown: the dashboard shows the message in
      // place, and a provider incident is not an admin-route error. The engine's
      // raw message goes to the server log only (it can contain connection or
      // table internals), never to the panel, and the failed run is audited
      // exactly like a success so the trail shows it happened.
      console.error(`[admin/sync] ${target} failed:`, error);
      await audit(ctx, `sync.${target}`, "manual", {
        ok: false,
        durationMs: Date.now() - started,
      });
      return {
        ok: false,
        target,
        durationMs: Date.now() - started,
        error: "sync failed",
      };
    }
  }, request);
}