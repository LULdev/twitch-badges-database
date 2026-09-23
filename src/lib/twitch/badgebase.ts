import { envOrNull } from "@/lib/env";
import type { FeedBadgeDetail } from "./types";

/**
 * Upper bound for any single third-party request, in milliseconds.
 *
 * 8 s rather than 15 s: the detail pass runs ceil(DETAIL_CAP/concurrency) waves
 * inside /api/cron/global's one 60 s `maxDuration`, so the per-fetch ceiling sets
 * the worst case (4 × 8 s = 32 s instead of 12 × 15 s = 180 s). A slow detail
 * page costs end-date precision on that one card, never a badge's confirmation —
 * that comes from the listing.
 */
const FETCH_TIMEOUT_MS = 8_000;


const DEFAULT_BASE = "https://badgebase.de";

const BADGE_UUID = /badges\/v1\/([0-9a-f-]{36})/i;

function base(): string {
  return envOrNull("BADGEBASE_BASE_URL") ?? DEFAULT_BASE;
}

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`${base()}${path}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "text/html" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`badgebase ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** A badge card parsed from the /active or /upcoming listing pages. */
export interface BadgebaseCard {
  /** Badge slug, e.g. "wsci-2026" (matches the catalog set_id in most cases). */
  slug: string;
  badgeId: string;
  status: "active" | "upcoming";
  tags: string[];
  /** Start/release timestamp in seconds (data-ts attribute). */
  startTs: number | null;
  imageUuid: string | null;
  imageUrl: string | null;
  title: string | null;
}

function attr(html: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(html);
  return match ? match[1] : null;
}

/**
 * Parse the curated listing pages:
 *   /active   → currently redeemable badges (start dates on the cards)
 *   /upcoming → announced badges before they go live (release dates)
 */
export async function fetchBadgebaseListing(
  path: "/active" | "/upcoming/",
): Promise<BadgebaseCard[]> {
  const html = await fetchHtml(path);
  const cards: BadgebaseCard[] = [];

  const anchor = /<a\s[^>]*href="(\/b\/(\d+)-([^"\/]+)\/)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = match[1];
    const badgeId = match[2];
    const slug = match[3];

    // Card content = from the anchor up to its closing tag.
    const start = match.index;
    const end = html.indexOf("</a>", start);
    if (end === -1) continue;
    const block = html.slice(start, end);

    const status = attr(block, "data-status");
    if (status !== "active" && status !== "upcoming") continue;

    const tags = (attr(block, "data-tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const ts = attr(block, "data-ts");
    const img = /<img[^>]+src="(https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/[^"]+)"/i.exec(
      block,
    );
    const titleMatch = /<h2[^>]*>\s*([\s\S]*?)\s*<\/h2>/i.exec(block);

    cards.push({
      slug,
      badgeId,
      status,
      tags,
      startTs: ts ? Number(ts) : null,
      imageUuid: img ? (BADGE_UUID.exec(img[1])?.[1] ?? null) : null,
      imageUrl: img ? img[1] : null,
      title: titleMatch
        ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
        : null,
    });
  }
  return cards;
}

/** Extended detail scrape: availability window + how-to-earn steps. */
export interface BadgebaseDetail extends FeedBadgeDetail {
  howToEarn: string | null;
  description: string | null;
}

interface HowToSchema {
  "@type"?: string;
  step?: Array<{ name?: string; text?: string }>;
}

function parseHowTo(html: string): string | null {
  // Detail pages embed schema.org HowTo JSON-LD with numbered steps.
  const blocks = html.match(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!blocks) return null;
  for (const block of blocks) {
    const jsonText = block.replace(/<[^>]+>/g, "");
    try {
      const parsed = JSON.parse(jsonText) as HowToSchema | HowToSchema[];
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (entry["@type"] !== "HowTo") continue;
        const steps = (entry.step ?? [])
          .map((step, index) => step.text?.trim() && `${index + 1}. ${step.text.trim()}`)
          .filter(Boolean) as string[];
        if (steps.length > 0) return steps.join(" ");
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

interface TemporalSchema {
  "@type"?: string;
  temporalCoverage?: string;
  datePublished?: string;
}

/**
 * Read the badge's real claim window from the page's schema.org ItemPage
 * JSON-LD:
 *   "temporalCoverage": "<start>/<end>"   (ISO 8601 interval)
 *   "datePublished":    "<release date>"
 *
 * `data-reset` must NOT be used: it belongs to the site's channel-points /
 * giveaway overlay (`.qlog-reset`, always the next midnight). Using it
 * poisoned every badge with an identical bogus end date and made
 * confirmed-active badges expire.
 */
function parseTemporalCoverage(html: string): {
  start: string | null;
  end: string | null;
  published: string | null;
} {
  const empty = { start: null, end: null, published: null };
  const blocks = html.match(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!blocks) return empty;

  for (const block of blocks) {
    const jsonText = block.replace(/<[^>]+>/g, "");
    let parsed: TemporalSchema | TemporalSchema[];
    try {
      parsed = JSON.parse(jsonText) as TemporalSchema | TemporalSchema[];
    } catch {
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      // Accept any entry that carries the fields — badgebase emits ItemPage,
      // but staying type-agnostic survives a schema tweak on their side.
      const coverage = entry.temporalCoverage?.trim();
      if (!coverage) continue;
      const [start, end] = coverage.split("/");
      return {
        start: start ? normalizeDate(start) : null,
        end: end ? normalizeDate(end) : null,
        published: entry.datePublished ? normalizeDate(entry.datePublished) : null,
      };
    }
  }
  return empty;
}

/** Coerce an ISO 8601 value to a valid UTC ISO string, or null. */
function normalizeDate(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function fetchBadgebaseDetail(
  slugPath: string,
): Promise<BadgebaseDetail> {
  const html = await fetchHtml(slugPath);

  const tsMatch = /data-ts="(\d+)"/.exec(html);
  const tagsMatch = /data-tags="([^"]*)"/.exec(html);
  const descMatch = /<meta name="description" content="([^"]*)"/i.exec(html);

  const { start, end, published } = parseTemporalCoverage(html);

  return {
    endDate: end,
    startDate:
      start ??
      published ??
      (tsMatch ? new Date(Number(tsMatch[1]) * 1000).toISOString() : null),
    tags: tagsMatch
      ? tagsMatch[1]
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    howToEarn: parseHowTo(html),
    description: descMatch ? descMatch[1] : null,
  };
}
