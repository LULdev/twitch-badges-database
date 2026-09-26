import { envOrNull } from "@/lib/env";

/**
 * Upper bound for any single third-party request, in milliseconds.
 *
 * The backfill runs inside /api/cron/archive's 60 s `maxDuration`, so a single
 * request must never be able to claim the whole budget: a capture that times
 * out is skipped and counted, never retried. 15 s matches potatFetch —
 * web.archive.org is not a fast API and a slow capture is normal.
 */
const FETCH_TIMEOUT_MS = 15_000;

const DEFAULT_CDX = "https://web.archive.org/cdx/search/cdx";

const DEFAULT_WEB = "https://web.archive.org";

const DEFAULT_CAPTURE_LIMIT = 200;

/** The CDX will happily answer with 100k rows; the sync only needs a bounded set. */
const MAX_CAPTURE_LIMIT = 1000;

/** CDX timestamps are always `YYYYMMDDhhmmss`; nothing else is a capture row. */
const CDX_TIMESTAMP = /^\d{14}$/;

function base(): string {
  return envOrNull("WAYBACK_CDX_URL") ?? DEFAULT_CDX;
}

function webBase(): string {
  return envOrNull("WAYBACK_WEB_URL") ?? DEFAULT_WEB;
}

/**
 * web.archive.org answers 429 with a Retry-After under load — honor it once,
 * then surface the failure instead of hammering the archive.
 *
 * A CDX response is routinely an empty body (the index holds no captures for
 * the target), so a non-2xx is the only hard failure here: empty resolves to
 * "" and the caller reads that as "no captures".
 */
async function waybackFetch(url: string, accept = "application/json"): Promise<string> {
  const request = () =>
    fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept },
      // A capture is immutable — never serve it from the data cache.
      next: { revalidate: 0 },
    });

  let res = await request();
  if (res.status === 429) {
    const explicit = res.headers.get("retry-after");
    const retryAfter = Number(explicit ?? "60");
    // Only an explicitly SHORT backoff is worth honouring. web.archive.org
    // answers 429 with `Retry-After: 60` (the same value potat sends), and
    // sleeping 60 s inside a 60 s serverless function is a guaranteed timeout
    // with no summary, no heartbeat and no changelog row. A missing header is
    // treated as un-retryable for the same reason.
    if (explicit && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 15) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      // The retry can be rate limited again (or fail otherwise) — its status
      // must be checked, or the caller parses an error body as captures.
      const retried = await request();
      if (!retried.ok) {
        throw new Error(
          `wayback ${url} still failing after retry: ${retried.status} ${retried.statusText}`,
        );
      }
      res = retried;
    } else {
      throw new Error(`wayback rate limited (Retry-After ${retryAfter}s)`);
    }
  }
  if (!res.ok) {
    throw new Error(`wayback ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** One dated capture of a page, as listed by the CDX index. */
export interface ArchiveCapture {
  /** Capture time in CDX form, `YYYYMMDDhhmmss` UTC (e.g. "20230418113000"). */
  timestamp: string;
  /** The original URL as archived, exactly as the index reported it. */
  original: string;
}

/** CDX `YYYYMMDDhhmmss` → a Date, or null when the field is not a timestamp. */
export function captureDate(timestamp: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The human-facing URL of a capture, for the `source_url` provenance column. */
export function captureUrl(capture: ArchiveCapture): string {
  const original = capture.original.startsWith("//")
    ? `https:${capture.original}`
    : capture.original;
  return `${webBase()}/web/${capture.timestamp}/${original}`;
}

export interface CaptureQuery {
  from?: string;
  to?: string;
  limit?: number;
  /**
   * A regular expression the CDX applies to the `original` field server-side.
   *
   * This is the only way to narrow a URL *tree* down to one page. CDX prefix
   * matching is a plain string prefix on the sorted URL key, not a glob, so
   * `badgebase.de/b/*-wsci-2026/*` would match nothing: badgebase's detail path
   * is `/b/{numericId}-{slug}/`, and the slug is preceded by an id nobody in
   * this repository stores. Querying the bare prefix `badgebase.de/b/` instead
   * returns every capture of every badge on the site, capped by `limit` and
   * therefore answering for whichever badges happen to sort first — a silent
   * wrong answer rather than an empty one. The filter is applied in the index
   * before the limit, so the cap then means "this badge's captures".
   */
  originalPattern?: string;
}

/**
 * List the captures the archive holds for `target`.
 *
 * `target` is a CDX `url` selector. A trailing `*` switches the query to
 * `matchType=prefix`, which is how a whole page tree is queried rather than
 * one exact URL. `from` / `to` are the CDX's own `YYYYMMDD` bounds, passed
 * through untouched.
 */
export async function fetchCaptures(
  target: string,
  options: CaptureQuery = {},
): Promise<ArchiveCapture[]> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_CAPTURE_LIMIT, 1),
    MAX_CAPTURE_LIMIT,
  );
  const params = new URLSearchParams({
    output: "json",
    fl: "timestamp,original,statuscode,digest",
    // `timestamp:6` keeps one capture per six-hour window. `digest` — the
    // obvious choice — keeps one per unique page CONTENT, which for a static
    // detail page means exactly one capture ever, and the feature's entire
    // reason for existing is the shape of the curve over time. Collapsing on
    // time bounds the row count without flattening the timeline.
    collapse: "timestamp:6",
    url: target,
    limit: String(limit),
  });
  // append, not set: a second `filter` ANDs onto the first rather than
  // replacing it, so statuscode and the original-pattern both apply.
  params.append("filter", "statuscode:200");
  if (options.originalPattern) {
    params.append("filter", `original:${options.originalPattern}`);
  }
  if (target.trim().endsWith("*")) params.set("matchType", "prefix");
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);

  const body = await waybackFetch(`${base()}?${params.toString()}`);
  // Empty is the common "nothing archived" answer, not a failure.
  if (body.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A broken parse that looks like "no captures" would report a healthy run
    // that recovered nothing — the caller must see the failure.
    throw new Error(
      `wayback CDX returned unparseable JSON (${body.length} bytes) for ${target}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  // The CDX JSON shape is the classic trap: one row comes back as a bare array
  // with no header, two or more come back as [header, ...rows]. A header cell is
  // never a 14-digit timestamp, which is how the two are told apart.
  const first = parsed[0];
  const headed = Array.isArray(first) && !CDX_TIMESTAMP.test(String(first[0]));
  const rows = headed ? parsed.slice(1) : parsed;

  const captures: ArchiveCapture[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const timestamp = typeof row[0] === "string" ? row[0] : "";
    const original = typeof row[1] === "string" ? row[1] : "";
    if (!CDX_TIMESTAMP.test(timestamp) || !original) continue;
    captures.push({ timestamp, original });
  }
  captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return captures;
}

/**
 * The raw archived markup for one capture.
 *
 * The `id_` modifier is deliberate: without it the Wayback injects its toolbar
 * chrome and rewrites asset URLs, which is exactly the kind of noise that makes
 * labelled-text owner-count extraction pick up a number from the wrong place.
 * With it, the original page bytes come back.
 */
export async function fetchSnapshot(capture: ArchiveCapture): Promise<string> {
  const original = capture.original.startsWith("//")
    ? `https:${capture.original}`
    : capture.original;
  return waybackFetch(
    `${webBase()}/web/${capture.timestamp}id_/${original}`,
    "text/html",
  );
}

/**
 * Keep at most `maxPerYear` captures per calendar year, evenly spaced through
 * the year, ascending.
 *
 * This is the cost bound: a popular badge page can have thousands of captures,
 * but a month's start tells you far more about the claim curve than a hundred
 * captures in one week. Even spacing (rather than the first N of the year) keeps
 * the whole span covered instead of collapsing it onto one week.
 */
export function spreadByYear(
  captures: ArchiveCapture[],
  maxPerYear: number,
): ArchiveCapture[] {
  if (maxPerYear <= 0) return [];

  const byYear = new Map<string, ArchiveCapture[]>();
  const sorted = [...captures].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  for (const capture of sorted) {
    const year = capture.timestamp.slice(0, 4);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(capture);
    else byYear.set(year, [capture]);
  }

  const kept: ArchiveCapture[] = [];
  for (const bucket of byYear.values()) {
    if (bucket.length <= maxPerYear) {
      kept.push(...bucket);
      continue;
    }
    // The even-spacing formula divides by maxPerYear - 1, so the single-capture
    // case has to branch before it or every index is NaN.
    if (maxPerYear === 1) {
      kept.push(bucket[0]);
      continue;
    }
    for (let i = 0; i < maxPerYear; i += 1) {
      const index = Math.round((i * (bucket.length - 1)) / (maxPerYear - 1));
      kept.push(bucket[index]);
    }
  }
  return kept.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
