import { createAdminClient } from "@/lib/supabase/admin";
import { classifyUserAgent } from "@/lib/analytics";
import { ipHashFromRequest } from "@/lib/gamification/session";

export const dynamic = "force-dynamic";

/**
 * Anonymous visitor beacon.
 *
 * Bounded on every axis, because this endpoint is reachable by anyone:
 *   - the path is truncated and stripped of query strings (a query string can
 *     carry a reset token or an email address, and it is not needed for a hit
 *     counter);
 *   - the locale is matched against the known list rather than stored raw;
 *   - the referrer is reduced to a hostname, never the full URL;
 *   - numeric fields are clamped;
 *   - `DNT: 1` records the path and nothing else — no visitor hash, no client
 *     class, no screen, no timezone.
 *
 * Failures are silent (204/202): a beacon must never surface an error to the
 * visitor or retry in a loop.
 */
const LOCALES = new Set(["en", "de", "fr", "es", "pt", "it", "ru", "zh", "ja", "ko", "ar"]);
const MAX_PATH = 200;
/**
 * A plausible ceiling for a single page view, in seconds. A tab left open
 * overnight (or a laptop resumed from sleep) reports hours, and the published
 * "average time on page" averages every non-null duration — so such a sample is
 * discarded rather than clamped, which would inject a maximal fake value.
 */
const MAX_DURATION_S = 1800;
/** How far back a duration beacon without an id may look for its own mount row. */
const DURATION_MATCH_MS = 120_000;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      path?: string;
      locale?: string;
      referrerHost?: string;
      screenW?: number;
      tzOffsetMins?: number;
      durationS?: number;
      /** The row this page view created on mount, for the duration update. */
      id?: number;
    } | null;

    // A beacon without a path is not a page view. Accepting it wrote a "/" row
    // for every empty or malformed payload, which padded the totals with hits
    // that never happened.
    if (!body || typeof body.path !== "string" || body.path.length === 0) {
      return new Response(null, { status: 202 });
    }

    // Query strings are dropped: they can carry a reset token or an address,
    // and a hit counter has no use for them.
    const path = body.path.split("?")[0].slice(0, MAX_PATH);
    if (!path || !path.startsWith("/")) {
      return new Response(null, { status: 202 });
    }
    const localeRaw = String(body.locale ?? "");
    const locale = LOCALES.has(localeRaw) ? localeRaw : "";

    const dnt = (request.headers.get("dnt") ?? "").trim() === "1";
    const ua = request.headers.get("user-agent") ?? "";
    const client = dnt ? { browser: "", os: "", device: "" } : classifyUserAgent(ua);

    const clamp = (value: unknown, min: number, max: number): number | null => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      return Math.min(Math.max(Math.trunc(parsed), min), max);
    };

    // The referrer is reduced to a host: the full URL of the page someone came
    // from is none of this site's business.
    let referrerHost = "";
    if (!dnt && typeof body?.referrerHost === "string") {
      referrerHost = body.referrerHost.toLowerCase().replace(/^www\./, "").slice(0, 120);
      if (!/^[a-z0-9.-]+$/.test(referrerHost)) referrerHost = "";
    }

    const supabase = createAdminClient();
    const visitorHash = dnt ? "" : ipHashFromRequest(request);

    // A duration beacon carries `durationS`; the mount beacon does not. That
    // distinguishes the two even for a DNT visitor, whose duration is nulled.
    const isDurationBeacon = typeof body?.durationS === "number";
    const rawDuration = Number(body?.durationS);
    const durationS = dnt
      ? null
      : !Number.isFinite(rawDuration)
        ? null
        : rawDuration < 0
          ? 0
          : rawDuration > MAX_DURATION_S
            ? null
            : Math.trunc(rawDuration);

    // A duration beacon carries the id of the row its own page view created on
    // mount, so the visit is UPDATED instead of inserting a second row. The old
    // shape inserted one row per beacon — i.e. two rows per page view — which
    // doubled every hit metric (`total_hits = count(*)`).
    const rowId = Number.isInteger(body?.id) ? (body?.id as number) : null;
    if (rowId !== null) {
      // Keyed on the visitor hash as well as the id: ids are a guessable identity,
      // so without the scope any caller could rewrite an arbitrary row's duration.
      // A hash mismatch simply matches nothing — the mount row keeps its NULL
      // duration, which is strictly better than accepting a foreign update.
      const { error } = await supabase
        .from("analytics_events")
        .update({ duration_s: durationS })
        .eq("id", rowId)
        .eq("visitor_hash", visitorHash);
      if (error) throw error;
      return new Response(null, { status: 204 });
    }

    if (isDurationBeacon && !dnt) {
      // The pagehide beacon raced ahead of the mount response, so the client never
      // learned its row id. Attach the duration to the most recent row this visitor
      // created for this path inside a short window instead of inserting a SECOND
      // row — which is the `total_hits = count(*)` inflation this change removes.
      const since = new Date(Date.now() - DURATION_MATCH_MS).toISOString();
      const { data: recent, error: findError } = await supabase
        .from("analytics_events")
        .select("id")
        .eq("visitor_hash", visitorHash)
        .eq("path", path)
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (findError) throw findError;
      if (recent) {
        const { error } = await supabase
          .from("analytics_events")
          .update({ duration_s: durationS })
          .eq("id", (recent as { id: number }).id)
          .eq("visitor_hash", visitorHash);
        if (error) throw error;
        return new Response(null, { status: 204 });
      }
      // No mount row to attach to: the mount beacon was lost, so this IS the only
      // record of the view — fall through and insert it rather than dropping it.
    }

    const { data, error } = await supabase
      .from("analytics_events")
      .insert({
        path,
        locale,
        referrer_host: referrerHost,
        // Empty hash for DNT visitors: the online count and unique-visitor count
        // exclude them rather than pretending they are one shared person.
        visitor_hash: visitorHash,
        browser: client.browser,
        os: client.os,
        device: client.device,
        screen_w: dnt ? null : clamp(body?.screenW, 0, 10000),
        tz_offset_mins: dnt ? null : clamp(body?.tzOffsetMins, -1440, 1440),
        duration_s: durationS,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;

    // The id goes back to the beacon so its pagehide event can attach the
    // duration to THIS row rather than writing a second one.
    return Response.json({
      ok: true,
      id: (data as { id: number } | null)?.id ?? null,
    });
  } catch (error) {
    console.warn("[track] beacon dropped:", error);
    // 202: accepted-in-spirit, nothing recorded — the client must not retry.
    return new Response(null, { status: 202 });
  }
}