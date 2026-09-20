import { XMLParser } from "fast-xml-parser";
import { envOrNull } from "@/lib/env";
import type { FeedBadge, FeedBadgeDetail } from "./types";

const DEFAULT_BASE = "https://badgebase.de";
const DEFAULT_FEED = "https://badgebase.de/feed.xml";

interface RssItem {
  title?: string | { "#text"?: string };
  link?: string;
  guid?: string;
  pubDate?: string;
  category?: string | string[];
  enclosure?: { url?: string } | { "@_url"?: string };
  description?: string;
}

interface RssDocument {
  rss?: { channel?: { item?: RssItem | RssItem[] } };
}

function text(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const inline: unknown = (value as { "#text"?: string })["#text"];
    if (typeof inline === "string") return inline;
  }
  return "";
}

function toList(value: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [String(value)];
}

/** badgebase.de RSS feed — badge drops with images and free/paid tags. */
export async function fetchBadgebaseFeed(): Promise<FeedBadge[]> {
  const feedUrl = envOrNull("BADGEBASE_FEED_URL") ?? DEFAULT_FEED;
  const res = await fetch(feedUrl, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`badgebase feed failed: ${res.status} ${res.statusText}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(await res.text()) as RssDocument;
  const items = doc.rss?.channel?.item;
  if (!items) return [];

  const badges: FeedBadge[] = [];
  for (const raw of Array.isArray(items) ? items : [items]) {
    const link = text(raw.link);
    const match = /\/b\/(\d+)-([^/]+)\/$/.exec(link);
    const enclosure = raw.enclosure as
      | { url?: string; "@_url"?: string }
      | undefined;
    const enclosureUrl = enclosure?.url ?? enclosure?.["@_url"];
    const categories = toList(raw.category);

    badges.push({
      sourceId: match ? Number(match[1]) : null,
      slug: match ? match[2] : null,
      name: text(raw.title),
      imageUrl: enclosureUrl ?? "",
      category: categories[0] ?? null,
      isPaid: categories.includes("paid")
        ? true
        : categories.includes("free")
          ? false
          : null,
      requirements: text(raw.description),
      link,
      pubDate: text(raw.pubDate) || null,
    });
  }
  return badges;
}

/** Scrape a badgebase detail page for availability window + tags. */
export async function fetchBadgebaseDetail(
  link: string,
): Promise<FeedBadgeDetail> {
  const base = envOrNull("BADGEBASE_BASE_URL") ?? DEFAULT_BASE;
  if (!link.startsWith("http")) link = `${base}${link}`;

  const res = await fetch(link, {
    headers: { accept: "text/html" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`badgebase detail failed: ${res.status} for ${link}`);
  }
  const html = await res.text();

  const endMatch = /data-reset="(\d+)"/.exec(html);
  const tsMatch = /data-ts="(\d+)"/.exec(html);
  const tagsMatch = /data-tags="([^"]*)"/.exec(html);
  const tags = tagsMatch
    ? tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return {
    endDate: endMatch
      ? new Date(Number(endMatch[1]) * 1000).toISOString()
      : null,
    startDate: tsMatch
      ? new Date(Number(tsMatch[1]) * 1000).toISOString()
      : null,
    tags,
  };
}
