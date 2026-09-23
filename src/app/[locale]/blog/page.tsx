import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listPosts } from "@/lib/queries";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });
  return {
    alternates: {
      canonical: `/${locale}/blog`,
      languages: localeAlternates("/blog"),
    }, title: t("title"), description: t("subtitle") };
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");

  const posts = await listPosts().catch(() => []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      {posts.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">{t("empty")}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="card card-interactive overflow-hidden"
            >
              {post.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.cover_url}
                  alt=""
                  width={640}
                  height={360}
                  loading="lazy"
                  className="aspect-video w-full bg-surface-2 object-contain p-4"
                />
              )}
              <div className="p-5">
                <div className="flex items-center gap-2">
                  {post.is_auto && (
                    <span className="chip pointer-events-none text-[0.5625rem]">
                      {t("autoTag")}
                    </span>
                  )}
                  {post.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="chip pointer-events-none text-[0.5625rem]">
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 className="mt-2.5 line-clamp-2 font-bold leading-snug">
                  {post.title}
                </h2>
                {post.excerpt && (
                  <p className="mt-1.5 line-clamp-3 text-[0.8125rem] leading-relaxed text-muted">
                    {post.excerpt}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted">
                  {t("published", {
                    date: new Date(post.published_at).toLocaleDateString(locale, {
                      dateStyle: "medium",
                    }),
                  })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
