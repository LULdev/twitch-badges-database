import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl, localeAlternates } from "@/lib/seo";
import { createAdminClient } from "@/lib/supabase/admin";
import { GAMES } from "@/lib/gamification/games";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticPaths = [
    "",
    "/badges",
    "/active",
    "/upcoming",
    "/expired",
    "/leaderboards",
    "/stats",
    "/compare",
    "/blog",
    "/changelog",
    "/faq",
    "/games",
    "/achievements",
    "/wheel",
    "/feed",
  ];

  // Load the dynamic rows first: their newest `updated_at` also becomes the
  // lastModified of the static pages. `new Date()` per entry made every URL
  // claim it had just changed on every revalidation, which search engines learn
  // to ignore.
  const badges: Array<{ slug: string; updated_at: string }> = [];
  const posts: Array<{ slug: string; updated_at: string }> = [];
  try {
    const supabase = createAdminClient();
    // Paged, because PostgREST caps a response at 1000 rows regardless of the
    // requested limit — a single request silently dropped everything past 1000.
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("badges")
        .select("slug, updated_at")
        .neq("status", "removed")
        .order("id")
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      badges.push(...((data ?? []) as typeof badges));
      if (!data || data.length < PAGE) break;
    }
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("slug, updated_at")
        .eq("status", "published")
        .order("id")
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      posts.push(...((data ?? []) as typeof posts));
      if (!data || data.length < PAGE) break;
    }
  } catch {
    // DB unavailable — static entries only, with no lastModified claim
  }

  const timestamps = [...badges, ...posts]
    .map((row) => new Date(row.updated_at).getTime())
    .filter((value) => Number.isFinite(value));
  const newest =
    timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

  const entries: MetadataRoute.Sitemap = [];

  for (const path of staticPaths) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        lastModified: newest ?? undefined,
        changeFrequency: path === "" ? "hourly" : "daily",
        priority: path === "" ? 1 : 0.7,
        // The same locale codes the pages emit (pt-BR, zh-Hans, …) plus
        // x-default. The sitemap used the raw locale ids and had no x-default,
        // so it contradicted the hreflang the pages themselves serve.
        alternates: { languages: localeAlternates(path || "/") },
      });
    }
  }

  // Every playable game has its own page and was absent from the sitemap.
  for (const game of GAMES) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${base}/${locale}/games/${game.id}`,
        lastModified: newest ?? undefined,
        changeFrequency: "weekly",
        priority: 0.5,
        alternates: { languages: localeAlternates(`/games/${game.id}`) },
      });
    }
  }

  for (const badge of badges) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${base}/${locale}/badges/${badge.slug}`,
        lastModified: new Date(badge.updated_at),
        changeFrequency: "daily",
        priority: 0.6,
        alternates: { languages: localeAlternates(`/badges/${badge.slug}`) },
      });
    }
  }

  for (const post of posts) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${base}/${locale}/blog/${post.slug}`,
        lastModified: new Date(post.updated_at),
        changeFrequency: "weekly",
        priority: 0.5,
        alternates: { languages: localeAlternates(`/blog/${post.slug}`) },
      });
    }
  }

  return entries;
}