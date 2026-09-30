import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getBadgeBySlug, getPostBySlug, listPosts } from "@/lib/queries";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";
import { jsonLdScript } from "@/lib/jsonld";
import ShareButtons from "@/components/ShareButtons";
import RarityChip from "@/components/badges/RarityChip";
import ReadingProgress from "@/components/blog/ReadingProgress";
import { localeAlternates, siteUrl } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordBlogView } from "@/lib/gamification/visits";
import { visitorIpHash } from "@/lib/gamification/session";
import EmojiReactions from "@/components/EmojiReactions";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getPostBySlug(slug).catch(() => null);
  // A draft is 404'd by the page body below, but generateMetadata ran first and
  // advertised a self-canonical plus a twelve-entry hreflang set for a page that
  // does not exist. Only published posts emit metadata.
  if (!post || post.status !== "published") return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("postTitle", { title: post.title });
  return {
    title,
    description: post.excerpt ?? post.title,
    alternates: {
      canonical: `/${locale}/blog/${post.slug}`,
      languages: localeAlternates(`/blog/${post.slug}`),
    },
    openGraph: {
      type: "article",
      // A page-level openGraph REPLACES the layout's, so siteName/url must be
      // restated here or the page emits no og:siteName and no og:url.
      siteName: t("siteTitle"),
      url: `/${locale}/blog/${post.slug}`,
      title,
      description: post.excerpt ?? post.title,
      publishedTime: post.published_at,
      images: post.cover_url ? [{ url: post.cover_url }] : undefined,
    },
    // Not optional: the layout's `twitter` block survives when a page omits it,
    // and X prefers twitter:title over og:title — every blog card showed the site
    // name while og:title was the post title. twitter:image still auto-fills from
    // openGraph.images.
    twitter: {
      card: "summary_large_image",
      title,
      description: post.excerpt ?? post.title,
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");
  const tc = await getTranslations("common");

  const post = await getPostBySlug(slug).catch(() => null);
  if (!post || post.status !== "published") notFound();

  const html = renderMarkdown(post.content);
  const headings = extractHeadings(post.content).filter((h) => h.level === 2);
  const words = post.content.split(/\s+/).filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.round(words / 200));

  // Adjacent and related posts (single catalog read; the blog is small).
  const allPosts = await listPosts().catch(() => []);
  const index = allPosts.findIndex((p) => p.slug === post.slug);
  const newer = index > 0 ? allPosts[index - 1] : null;
  const older = index >= 0 && index < allPosts.length - 1 ? allPosts[index + 1] : null;
  const related = allPosts
    .filter((p) => p.slug !== post.slug && p.tags.some((tag) => post.tags.includes(tag)))
    .slice(0, 3);

  // Drop posts (slug "drop-<badgeslug>") embed the live badge record.
  const badgeSlug = post.slug.startsWith("drop-") ? post.slug.slice(5) : null;
  const badge =
    badgeSlug !== null
      ? await getBadgeBySlug(badgeSlug).catch(() => null)
      : null;

  // View counter (5-minute per-IP dedup) + emoji reactions.
  let viewCount = 0;
  const reactions: Record<string, number> = {};
  let myReactions: string[] = [];
  try {
    const ipHash = await visitorIpHash();
    await recordBlogView(post.id, ipHash);
    // Reads go through the anon server client: migration 0011 gave both tables
    // a public-read policy with column-level grants, so no RLS bypass is needed
    // here (and `ip_hash` stays unreachable). recordBlogView above is a write
    // and keeps its own service-role path.
    const supabase = await createClient();
    const [viewsRes, reactionsRes] = await Promise.all([
      supabase.from("blog_views").select("post_id", { count: "exact", head: true }).eq("post_id", post.id),
      // Without the post filter this counted every reaction on the whole blog,
      // so all posts displayed identical totals.
      supabase.from("blog_reactions").select("emoji").eq("post_id", post.id),
    ]);
    viewCount = viewsRes.count ?? 0;
    for (const row of (reactionsRes.data ?? []) as Array<{ emoji: string }>) {
      reactions[row.emoji] = (reactions[row.emoji] ?? 0) + 1;
    }
    // Which of these reactions are the visitor's own. `ip_hash` is deliberately
    // not readable with the anon key (migration 0011 grants only post_id, emoji,
    // created_at), so this one lookup uses the service-role client — server
    // component, emoji keys only, never a hash. The page is dynamic regardless:
    // visitorIpHash() above reads request headers.
    const { data: mine } = await createAdminClient()
      .from("blog_reactions")
      .select("emoji")
      .eq("post_id", post.id)
      .eq("ip_hash", ipHash);
    myReactions = [
      ...new Set((mine ?? []).map((row) => (row as { emoji: string }).emoji)),
    ];
  } catch {
    // counters are best-effort
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: post.cover_url ?? undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    inLanguage: locale,
    mainEntityOfPage: `${siteUrl()}/${locale}/blog/${post.slug}`,
    author: { "@type": "Organization", name: post.author, url: siteUrl() },
    publisher: { "@type": "Organization", name: "Twitch Badges Database", url: siteUrl() },
  };

  const fmtDate = (value: string) =>
    new Date(value).toLocaleDateString(locale, { dateStyle: "long" });

  return (
    <article className="mx-auto max-w-5xl">
      <ReadingProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
        <Link href="/blog" className="hover:text-foreground">
          {t("back")}
        </Link>
      </nav>

      <header className="mt-3 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {post.is_auto && (
            <span className="chip pointer-events-none">{t("autoTag")}</span>
          )}
          {post.tags.map((tag) => (
            <span key={tag} className="chip pointer-events-none">
              {tag}
            </span>
          ))}
        </div>
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
          {post.title}
        </h1>
        <div className="bl-byline">
          <span>
            {t("published", { date: fmtDate(post.published_at) })}
          </span>
          <span>{t("by", { author: post.author })}</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden focusable="false">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {viewCount.toLocaleString(locale)}
          </span>
          <span className="tabular-nums">{t("readingTime", { min: readingMinutes })}</span>
          {post.updated_at !== post.published_at && (
            <span>{t("updatedAt", { date: fmtDate(post.updated_at) })}</span>
          )}
        </div>
      </header>

      {post.cover_url && (
        <div className="bl-cover-stage mt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.cover_url} alt="" width={848} height={477} />
        </div>
      )}

      {badge && (
        <aside className="bl-widget mt-6" aria-label={t("widgetTitle")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <RarityChip tier={badge.rarity_tier} score={badge.rarity_score} />
              <span className="text-xs text-muted">
                {t("widgetOwners", {
                  count: (badge.owner_count ?? 0).toLocaleString(locale),
                })}
              </span>
            </div>
            <Link href={`/badges/${badge.slug}`} className="btn btn-primary text-xs">
              {t("widgetOpen")}
            </Link>
          </div>
          <p className="mt-2 text-xs text-muted">
            {badge.start_date || badge.end_date
              ? t("widgetClaim", {
                  start: badge.start_date ? fmtDate(badge.start_date) : "—",
                  end: badge.end_date ? fmtDate(badge.end_date) : "—",
                })
              : t("widgetNoWindow")}
          </p>
        </aside>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div
            className="prose-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <div className="mt-8 border-t border-line pt-4">
            <EmojiReactions
              slug={post.slug}
              initial={reactions}
              initialActive={myReactions}
            />
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <ShareButtons
              path={`/${locale}/blog/${post.slug}`}
              title={`${post.title} — Twitch Badges Database`}
            />
          </div>
        </div>

        <aside className="hidden lg:block">
          {headings.length > 1 && (
            <nav className="bl-toc" aria-label={t("tocTitle")}>
              <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted">
                {t("tocTitle")}
              </p>
              <ol>
                {headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`}>{h.text}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </aside>
      </div>

      <nav className="bl-pn mt-8" aria-label={t("prevNext")}>
        {older ? (
          <Link href={`/blog/${older.slug}`} className="prev">
            <span className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-muted">
              {t("prevPost")}
            </span>
            <span className="line-clamp-2 text-sm font-bold leading-snug">
              {older.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={`/blog/${newer.slug}`} className="next">
            <span className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-muted">
              {t("nextPost")}
            </span>
            <span className="line-clamp-2 text-sm font-bold leading-snug">
              {newer.title}
            </span>
          </Link>
        ) : null}
      </nav>

      {related.length > 0 && (
        <section className="mt-8" aria-label={t("relatedTitle")}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted">
            {t("relatedTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {related.map((p) => (
              <Link key={p.id} href={`/blog/${p.slug}`} className="bl-placard block p-4">
                <div className="flex items-center gap-1.5">
                  {p.tags.slice(0, 1).map((tag) => (
                    <span key={tag} className="chip pointer-events-none text-[0.5625rem]">
                      {tag}
                    </span>
                  ))}
                </div>
                <h3 className="mt-2 line-clamp-2 text-sm font-bold leading-snug">
                  {p.title}
                </h3>
                <p className="mt-1.5 text-xs text-muted">
                  {fmtDate(p.published_at)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
