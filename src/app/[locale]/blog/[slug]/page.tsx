import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPostBySlug } from "@/lib/queries";
import { renderMarkdown } from "@/lib/markdown";
import { jsonLdScript } from "@/lib/jsonld";
import ShareButtons from "@/components/ShareButtons";
import { localeAlternates } from "@/lib/seo";
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
    author: { "@type": "Organization", name: post.author },
  };

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
        <Link href="/blog" className="hover:text-foreground">
          {t("back")}
        </Link>
      </nav>

      <header className="space-y-3">
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
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight">
          {post.title}
        </h1>
        <p className="text-sm text-muted">
          {t("published", {
            date: new Date(post.published_at).toLocaleDateString(locale, {
              dateStyle: "long",
            }),
          })}{" "}
          · {t("by", { author: post.author })} ·{" "}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden focusable="false">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {viewCount.toLocaleString(locale)}
          </span>
        </p>
      </header>

      {post.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.cover_url}
          alt=""
          width={848}
          height={477}
          className="card w-full bg-surface-2 object-contain p-6"
        />
      )}

      <div
        className="prose-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <div className="border-t border-line pt-4">
        <EmojiReactions
          slug={post.slug}
          initial={reactions}
          initialActive={myReactions}
        />
      </div>
      <div className="border-t border-line pt-4">
        <ShareButtons
          path={`/${locale}/blog/${post.slug}`}
          title={`${post.title} — Twitch Badges Database`}
        />
      </div>
    </article>
  );
}
