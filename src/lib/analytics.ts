import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Visitor analytics: a coarse, privacy-preserving hit log written by an
 * anonymous beacon (`/api/track`) and read through aggregate views.
 *
 * What is NOT stored, deliberately: no IP address, no user agent string, no
 * query string, no referrer URL — only a host, only a class of browser/OS/device
 * derived server-side, and a salted hash of the IP that changes with the salt
 * and exists purely to count distinct visitors and "online now". A visitor who
 * sends `DNT: 1` is counted as a path hit and nothing else.
 *
 * IP hashing reuses the app-wide salt logic (see gamification/session), so the
 * analytics hash and the view-dedup hash are the same shape and neither is
 * reversible from a public value.
 */

export interface AnalyticsSummary {
  total_hits: number;
  unique_visitors: number;
  hits_24h: number;
  hits_7d: number;
  hits_30d: number;
  hits_90d: number;
  online_now: number;
  avg_duration_s: number | null;
  /** Distinct visitors in the last 30 days — appended by migration 0036 so the
   *  "Views 30d" tile can show a number that matches its own window. */
  unique_visitors_30d: number;
}

export interface AnalyticsDailyRow {
  day: string;
  hits: number;
  visitors: number;
}

export interface AnalyticsCountRow {
  hits: number;
  [key: string]: string | number;
}

export interface AnalyticsClientRow {
  browser: string;
  os: string;
  device: string;
  hits: number;
}

export interface AnalyticsBundle {
  summary: AnalyticsSummary | null;
  daily: AnalyticsDailyRow[];
  paths: Array<{ path: string; hits: number }>;
  referrers: Array<{ referrer_host: string; hits: number }>;
  clients: AnalyticsClientRow[];
  locales: Array<{ locale: string; hits: number }>;
}

const EMPTY_SUMMARY: AnalyticsSummary = {
  total_hits: 0,
  unique_visitors: 0,
  hits_24h: 0,
  hits_7d: 0,
  hits_30d: 0,
  hits_90d: 0,
  online_now: 0,
  avg_duration_s: null,
  unique_visitors_30d: 0,
};

/** Reads every analytics view. Wrapped per query so a missing view (the site
 *  runs before migration 0025 is applied) yields empty data, not a crash. */
export async function getAnalytics(): Promise<AnalyticsBundle> {
  // The service role, not the anon client: migration 0030 revoked the public
  // grants on these views because `top_paths` published raw paths (including
  // profile URLs) and `referrers` published referring hosts to anyone holding the
  // publishable key. This function only ever runs server-side.
  const supabase = createAdminClient();
  const safe = async <T>(run: () => PromiseLike<{ data: unknown }>, fallback: T): Promise<T> => {
    try {
      const { data } = await run();
      return (data ?? fallback) as T;
    } catch {
      return fallback;
    }
  };

  const [summary, daily, paths, referrers, clients, locales] = await Promise.all([
    safe<AnalyticsSummary | null>(
      () => supabase.from("stats_analytics_summary").select("*").maybeSingle(),
      null,
    ),
    safe<AnalyticsDailyRow[]>(() => supabase.from("stats_analytics_daily").select("*"), []),
    safe<Array<{ path: string; hits: number }>>(
      () => supabase.from("stats_analytics_top_paths").select("*"),
      [],
    ),
    safe<Array<{ referrer_host: string; hits: number }>>(
      () => supabase.from("stats_analytics_top_referrers").select("*"),
      [],
    ),
    safe<AnalyticsClientRow[]>(() => supabase.from("stats_analytics_clients").select("*"), []),
    safe<Array<{ locale: string; hits: number }>>(
      () => supabase.from("stats_analytics_locales").select("*"),
      [],
    ),
  ]);

  return {
    summary: summary ? { ...EMPTY_SUMMARY, ...summary } : null,
    daily,
    paths,
    referrers,
    clients,
    locales,
  };
}

/**
 * Coarse client classification from the User-Agent header.
 *
 * The raw header is never stored — this reduces it to three short labels, which
 * is all the dashboard needs and all that can be justified keeping.
 */
export function classifyUserAgent(ua: string): {
  browser: string;
  os: string;
  device: string;
} {
  const value = ua || "";
  const browser =
    /Edg\//.test(value) ? "Edge"
    : /OPR\/|Opera/.test(value) ? "Opera"
    : /Firefox\//.test(value) ? "Firefox"
    : /Chrome\/|CriOS/.test(value) ? "Chrome"
    : /Safari\//.test(value) ? "Safari"
    : /curl|bot|crawl|spider/i.test(value) ? "Bot"
    : "Other";

  const os =
    /Windows NT/.test(value) ? "Windows"
    : /Android/.test(value) ? "Android"
    : /iPhone|iPad|iPod/.test(value) ? "iOS"
    : /Mac OS X/.test(value) ? "macOS"
    : /Linux/.test(value) ? "Linux"
    : "Other";

  const device =
    /iPad|Tablet/.test(value) ? "tablet"
    : /Mobi|Android|iPhone/.test(value) ? "mobile"
    : "desktop";

  return { browser, os, device };
}

/**
 * Live reachability probes for the status tab.
 *
 * These are genuine outbound requests with a short timeout, so "online" means
 * "answered just now" rather than "the last cron said ok".
 */
export interface LiveProbe {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export async function runLiveProbes(): Promise<LiveProbe[]> {
  const targets: Array<{ name: string; url: string }> = [
    { name: "twitch-helix", url: "https://id.twitch.tv/oauth2/token" },
    { name: "badgebase", url: "https://badgebase.de/" },
    { name: "potat", url: "https://potat.app/" },
  ];
  const database: LiveProbe = await (async () => {
    const started = Date.now();
    try {
      const supabase = createAdminClient();
      const { error } = await supabase.from("badges").select("id", { head: true, count: "exact" }).limit(1);
      if (error) throw error;
      return { name: "database", ok: true, ms: Date.now() - started };
    } catch (error) {
      return {
        name: "database",
        ok: false,
        ms: Date.now() - started,
        detail: error instanceof Error ? error.message : "failed",
      };
    }
  })();

  const remote = await Promise.all(
    targets.map(async (target): Promise<LiveProbe> => {
      const started = Date.now();
      try {
        // Any HTTP answer proves the host is reachable; a 4xx on a login
        // endpoint is a healthy service, not an outage.
        const response = await fetch(target.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(4000),
          cache: "no-store",
        });
        return { name: target.name, ok: response.status < 500, ms: Date.now() - started, detail: `HTTP ${response.status}` };
      } catch (error) {
        return {
          name: target.name,
          ok: false,
          ms: Date.now() - started,
          detail: error instanceof Error ? error.message : "unreachable",
        };
      }
    }),
  );

  return [database, ...remote];
}