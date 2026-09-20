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
      const url = `${siteUrl()}/en/changelog`;
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
