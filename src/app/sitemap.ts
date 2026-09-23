import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl, localeAlternates } from "@/lib/seo";
import { createAdminClient } from "@/lib/supabase/admin";
import { GAMES } from "@/lib/gamification/games";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  // `/feed` 404s when its feature flag is off, and advertising a 404 is worse than
  // omitting the page. Read the flag with the admin client directly rather than
  // through `getFeatures()`: that accessor uses the anon server client, which
  // awaits `cookies()` and would turn this route dynamic — losing the hourly ISR
  // cache and adding a DB round-trip to every crawl.
  let feedEnabled = true;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "features")
      .maybeSingle();
    const feed = (data?.value as { feed?: unknown } | null)?.feed;
    if (typeof feed === "boolean") feedEnabled = feed;
  } catch {
    // Settings unavailable: keep the entry rather than dropping a live page.
  }

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
    ...(feedEnabled ? ["/feed"] : []),
  ];

  // Load the dynamic rows first: their newest `updated_at` also becomes the
  // lastModified of the static pages. `new Date()` per entry made every URL
  // claim it had just changed on every revalidation, which search engines learn
  // to ignore.
  // PostgREST caps a response at 1000 rows regardless of the requested limit, so
  // every sweep below pages explicitly.
  const PAGE = 1000;

  const badges: Array<{ slug: string; updated_at: string }> = [];
  const posts: Array<{ slug: string; updated_at: string }> = [];
  // Public profiles were absent from the sitemap although the pages are
  // indexable and emit canonical + hreflang — a whole page family crawlers never
  // saw. Only rows with a usable username, ordered deterministically.
  const profiles: string[] = [];
  try {
    const supabase = createAdminClient();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .not("username", "is", null)
        .neq("username", "")
        .order("id")
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      profiles.push(
        ...(data ?? []).map((row) => String(row.username)).filter(Boolean),
      );
      if (!data || data.length < PAGE) break;
    }
  } catch {
    // DB unavailable for profiles — the other families still build below.
  }
  try {
    const supabase = createAdminClient();
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

  for (const username of profiles) {
    for (const locale of routing.locales) {
      entries.push({
        url: `${base}/${locale}/profile/${username}`,
        lastModified: newest ?? undefined,
        changeFrequency: "weekly",
        priority: 0.4,
        alternates: { languages: localeAlternates(`/profile/${username}`) },
      });
    }
  }

  return entries;
}