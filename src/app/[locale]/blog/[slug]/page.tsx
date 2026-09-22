import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPostBySlug } from "@/lib/queries";
import { renderMarkdown } from "@/lib/markdown";
import { jsonLdScript } from "@/lib/jsonld";
import ShareButtons from "@/components/ShareButtons";
import { localeAlternates } from "@/lib/seo";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordBlogView } from "@/lib/gamification/visits";
import { visitorIpHash } from "@/lib/gamification/session";
import EmojiReactions from "@/components/EmojiReactions";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getPostBySlug(slug).catch(() => null);
  if (!post) return {};
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
      title,
      description: post.excerpt ?? post.title,
      publishedTime: post.published_at,
      images: post.cover_url ? [{ url: post.cover_url }] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");

  const post = await getPostBySlug(slug).catch(() => null);
  if (!post || post.status !== "published") notFound();

  const html = renderMarkdown(post.content);

  // View counter (5-minute per-IP dedup) + emoji reactions.
  let viewCount = 0;
  const reactions: Record<string, number> = {};
  try {
    const ipHash = await visitorIpHash();
    await recordBlogView(post.id, ipHash);
    const admin = createAdminClient();
    const [viewsRes, reactionsRes] = await Promise.all([
      admin.from("blog_views").select("id", { count: "exact", head: true }).eq("post_id", post.id),
      admin.from("blog_reactions").select("emoji"),
    ]);
    viewCount = viewsRes.count ?? 0;
    for (const row of (reactionsRes.data ?? []) as Array<{ emoji: string }>) {
      reactions[row.emoji] = (reactions[row.emoji] ?? 0) + 1;
    }
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

      <nav className="text-xs text-muted" aria-label="Breadcrumb">
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
          · {t("by", { author: post.author })} · <span className="tabular-nums">👁 {viewCount.toLocaleString(locale)}</span>
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
        <EmojiReactions slug={post.slug} initial={reactions} />
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
