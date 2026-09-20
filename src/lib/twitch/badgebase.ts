import { envOrNull } from "@/lib/env";
import type { FeedBadgeDetail } from "./types";

const DEFAULT_BASE = "https://badgebase.de";

const BADGE_UUID = /badges\/v1\/([0-9a-f-]{36})/i;

function base(): string {
  return envOrNull("BADGEBASE_BASE_URL") ?? DEFAULT_BASE;
}

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`${base()}${path}`, {
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

export async function fetchBadgebaseDetail(
  slugPath: string,
): Promise<BadgebaseDetail> {
  const html = await fetchHtml(slugPath);

  const endMatch = /data-reset="(\d+)"/.exec(html);
  const tsMatch = /data-ts="(\d+)"/.exec(html);
  const tagsMatch = /data-tags="([^"]*)"/.exec(html);
  const descMatch = /<meta name="description" content="([^"]*)"/i.exec(html);

  return {
    endDate: endMatch
      ? new Date(Number(endMatch[1]) * 1000).toISOString()
      : null,
    startDate: tsMatch
      ? new Date(Number(tsMatch[1]) * 1000).toISOString()
      : null,
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
