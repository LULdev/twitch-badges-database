import { listPosts } from "@/lib/queries";
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
  const posts = await listPosts().catch(() => []);

  const items = posts
    .slice(0, 100)
    .map((post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${siteUrl()}/en/blog/${escapeXml(post.slug)}</link>
      <guid isPermaLink="false">blog-${escapeXml(post.slug)}</guid>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      ${post.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join("\n      ")}
      <description>${escapeXml(post.excerpt ?? post.title)}</description>
    </item>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Twitch Badges Database — Blog</title>
    <link>${siteUrl()}/en/blog</link>
    <description>Badge drops, rarity deep-dives and platform features — published automatically as the catalog changes.</description>
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
