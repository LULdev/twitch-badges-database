import { listChangelog } from "@/lib/queries";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const entries = await listChangelog(undefined, 100).catch(() => []);

  const items = entries
    .map((entry) => {
      // Per-item permalink. This was one shared `/en/changelog` for all 100
      // items, so every "read more" opened the same page and readers collapsed
      // the feed into a single URL; `<guid>` was already per-item but `<link>` is
      // the item permalink per RSS 2.0. The changelog page carries a matching
      // `id="changelog-<id>"` on each row.
      const url = `${siteUrl()}/en/changelog#changelog-${entry.id}`;
      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">changelog-${entry.id}</guid>
      <pubDate>${new Date(entry.created_at).toUTCString()}</pubDate>
      <category>${escapeXml(entry.kind)}</category>
      <description>${escapeXml(entry.body ?? entry.title)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Twitch Badges Database — Changelog</title>
    <link>${siteUrl()}/en/changelog</link>
    <description>Every change, fix and sync — logged automatically with timestamps.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
