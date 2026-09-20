import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/seo";
import { createAdminClient } from "@/lib/supabase/admin";

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
  ];

  const entries: MetadataRoute.Sitemap = [];
  for (const path of staticPaths) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        lastModified: new Date(),
        changeFrequency: path === "" ? "hourly" : "daily",
        priority: path === "" ? 1 : 0.7,
        alternates: {
          languages: Object.fromEntries(
            routing.locales.map((alt) => [alt, `${base}/${alt}${path}`]),
          ),
        },
      });
    }
  }

  try {
    const supabase = createAdminClient();
    const [{ data: badges }, { data: posts }] = await Promise.all([
      supabase.from("badges").select("slug, updated_at").neq("status", "removed").limit(3000),
      supabase
        .from("blog_posts")
        .select("slug, updated_at")
        .eq("status", "published")
        .limit(1000),
    ]);

    for (const badge of (badges ?? []) as Array<{ slug: string; updated_at: string }>) {
      for (const locale of routing.locales) {
        entries.push({
          url: `${base}/${locale}/badges/${badge.slug}`,
          lastModified: new Date(badge.updated_at),
          changeFrequency: "daily",
          priority: 0.6,
        });
      }
    }
    for (const post of (posts ?? []) as Array<{ slug: string; updated_at: string }>) {
      for (const locale of routing.locales) {
        entries.push({
          url: `${base}/${locale}/blog/${post.slug}`,
          lastModified: new Date(post.updated_at),
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }
  } catch {
    // DB unavailable — static entries only
  }

  return entries;
}
