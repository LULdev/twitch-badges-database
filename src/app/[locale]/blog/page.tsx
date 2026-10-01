import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listPosts, type BlogPostRow } from "@/lib/queries";
import { localeAlternates } from "@/lib/seo";
import Reveal from "@/components/stats/Reveal";

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
    },
    title: t("title"),
    description: t("subtitle"),
  };
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tag?: string | string[] }>;
}

function Cover({
  post,
  variant = "card",
  className = "",
}: {
  post: BlogPostRow;
  /** "card": framed 16:9 tile · "free": unconstrained float for hero stages */
  variant?: "card" | "free";
  className?: string;
}) {
  const imgClass =
    variant === "card"
      ? `aspect-video w-full bg-surface-2 object-contain p-4 ${className}`
      : `max-h-full max-w-full object-contain ${className}`;
  if (!post.cover_url) {
    return (
      <div
        className={
          variant === "card"
            ? `grid aspect-video place-items-center bg-surface-3 ${className}`
            : `grid size-24 place-items-center bg-surface-3 ${className}`
        }
        aria-hidden="true"
      >
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted/60">
          <rect x="3" y="4" width="18" height="15" rx="2" />
          <path d="m3 15 4.5-4.5 3.5 3.5 3-3L21 17" />
          <circle cx="15.5" cy="8.5" r="1.5" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={post.cover_url}
      alt=""
      width={640}
      height={360}
      loading="lazy"
      className={imgClass}
    />
  );
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const [sp] = await Promise.all([searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("blog");

  const allPosts = await listPosts().catch(() => []);

  // Server-side tag filter (?tag=) — same pattern as the changelog's ?kind=.
  const tags = [...new Set(allPosts.flatMap((p) => p.tags))].sort();
  const single = Array.isArray(sp.tag) ? sp.tag[0] : sp.tag;
  const activeTag = single && tags.includes(single) ? single : "";
  const posts = activeTag
    ? allPosts.filter((p) => p.tags.includes(activeTag))
    : allPosts;

  const now = new Date();
  const postsThisMonth = allPosts.filter((p) => {
    const d = new Date(p.published_at);
    return (
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth()
    );
  }).length;
  const latest = allPosts[0];
  const latestLabel = latest
    ? new Date(latest.published_at).toLocaleDateString(locale, {
        dateStyle: "medium",
      })
    : "—";
  const featured = allPosts.find((p) => !p.is_auto) ?? allPosts[0];
  const dropPosts = allPosts.filter(
    (p) => p.tags.includes("drop") && p.slug !== featured?.slug,
  );

  const fmtDate = (value: string, style: "medium" | "long" = "medium") =>
    new Date(value).toLocaleDateString(locale, { dateStyle: style });

  const tagHref = (value: string) =>
    value === "" ? `/blog` : `/blog?tag=${encodeURIComponent(value)}`;

  /* ---------------------------------------------------------------- */
  /* Masthead                                                          */
  /* ---------------------------------------------------------------- */
  const header = (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="bl-kpi">
          <b>{allPosts.length.toLocaleString(locale)}</b>
          <span>{t("statPosts")}</span>
        </div>
        <div className="bl-kpi">
          <b>{postsThisMonth.toLocaleString(locale)}</b>
          <span>{t("statMonth")}</span>
        </div>
        <div className="bl-kpi">
          <b className="text-sm">{latestLabel}</b>
          <span>{t("statLatest")}</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route serving XML, not a page */}
        <a href="/api/blog/rss" className="btn btn-secondary text-xs" title={t("rss")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="6.5" cy="17.5" r="2.5" />
            <path d="M4 4a16 16 0 0 1 16 16h-3A13 13 0 0 0 4 7z" />
            <path d="M4 10a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z" />
          </svg>
          {t("rss")}
        </a>
      </div>
    </header>
  );

  const tagRail =
    tags.length > 1 ? (
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t("tagFilter")}
      >
        <Link
          href={tagHref("")}
          className={`chip ${activeTag === "" ? "chip-active" : ""}`}
        >
          {t("allTags")}
        </Link>
        {tags.map((tag) => (
          <Link
            key={tag}
            href={tagHref(tag)}
            className={`chip ${activeTag === tag ? "chip-active" : ""}`}
          >
            {tag}
          </Link>
        ))}
      </div>
    ) : null;

  const emptyState = (
    <div className="card p-10 text-center text-sm text-muted">
      {activeTag ? t("emptyFilter") : t("empty")}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Featured card (hidden while a tag filter is active)               */
  /* ---------------------------------------------------------------- */
  const featuredCard =
    featured && !activeTag ? (
      <Reveal>
        <section className="card overflow-hidden" aria-label={t("featured")}>
          <div className="bl-feature p-6 sm:p-8">
            <Link
              href={`/blog/${featured.slug}`}
              className="bl-feature-cover"
              aria-label={featured.title}
            >
              <Cover post={featured} variant="free" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip pointer-events-none text-[0.5625rem] chip-active">
                  {t("featured")}
                </span>
                {featured.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="chip pointer-events-none text-[0.5625rem]">
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
                {featured.title}
              </h2>
              {featured.excerpt && (
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
                  {featured.excerpt}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                {t("published", { date: fmtDate(featured.published_at) })}
              </p>
              <Link href={`/blog/${featured.slug}`} className="btn btn-primary mt-4 text-sm">
                {t("readMore")}
              </Link>
            </div>
          </div>
        </section>
      </Reveal>
    ) : null;

  /* ---------------------------------------------------------------- */
  /* Latest drops grid (three newest drop cards)                       */
  /* ---------------------------------------------------------------- */
  const dropGrid =
    dropPosts.length > 0 && !activeTag ? (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dropPosts.slice(0, 3).map((post, i) => (
          <Reveal key={post.id} delay={i * 80}>
            <Link
              href={`/blog/${post.slug}`}
              className="card card-interactive flex h-full flex-col overflow-hidden"
            >
              <Cover post={post} />
              <div className="flex flex-1 flex-col p-5">
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
                <p className="mt-auto pt-3 text-xs text-muted">
                  {t("published", { date: fmtDate(post.published_at) })}
                </p>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    ) : null;

  /* ---------------------------------------------------------------- */
  /* Drop activity density strip (30 days)                             */
  /* ---------------------------------------------------------------- */
  const dayMap = new Map<string, BlogPostRow[]>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), []);
  }
  for (const post of allPosts) {
    const key = post.published_at.slice(0, 10);
    if (dayMap.has(key)) dayMap.get(key)!.push(post);
  }
  const maxDay = Math.max(1, ...[...dayMap.values()].map((v) => v.length));
  const level = (n: number) =>
    n === 0 ? "0" : n >= maxDay ? "max" : String(Math.min(3, n));
  const densityStrip = (
    <section aria-label={t("wireDensity")} className="card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="wire-mono text-[0.6875rem] text-muted">
          {t("wireDensity")}
        </h2>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route serving XML, not a page */}
        <a href="/api/blog/rss" className="wire-mono text-[0.625rem] text-muted hover:text-accent">
          {t("rss")}
        </a>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(1.6rem,1fr))] gap-1">
        {[...dayMap.entries()].map(([day, dayPosts]) =>
          dayPosts.length > 0 ? (
            <Link
              key={day}
              href={`/blog/${dayPosts[0].slug}`}
              className="bl-day-cell"
              data-count={level(dayPosts.length)}
              title={`${day} · ${dayPosts.length}`}
            >
              {dayPosts.length}
              <span className="sr-only">
                {`${day} — ${dayPosts.length} ${t("statPosts")}`}
              </span>
            </Link>
          ) : (
            <span key={day} className="bl-day-cell" data-count="0" aria-hidden="true" />
          ),
        )}
      </div>
    </section>
  );

  /* ---------------------------------------------------------------- */
  /* Dispatch list (full catalog, newest = highest index)              */
  /* ---------------------------------------------------------------- */
  // Month headings computed purely by index comparison — no accumulator, per
  // the React Compiler purity rule (the changelog Ledger's isNewMonth).
  const monthOf = (value: string) =>
    new Date(value).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const isNewMonth = (list: typeof posts, i: number) =>
    i === 0 || monthOf(list[i].published_at) !== monthOf(list[i - 1].published_at);
  const dispatchList =
    posts.length === 0 ? (
      emptyState
    ) : (
      <section className="card overflow-hidden" aria-label={t("title")}>
        <ol>
          {posts.map((post, i) => (
            <li key={post.id}>
              {isNewMonth(posts, i) && (
                <div className="wire-month" role="presentation">
                  {monthOf(post.published_at)}
                </div>
              )}
              <Link href={`/blog/${post.slug}`} className="wire-row">
                <span className="wire-idx">
                  {String(posts.length - i).padStart(3, "0")}
                </span>
                <span className="wire-time">
                  {post.published_at.slice(0, 10)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {post.title}
                  </span>
                  <span className="wire-mono block text-[0.5625rem] text-muted">
                    {post.tags.slice(0, 3).join(" · ")}
                  </span>
                </span>
                <span className="wire-mono hidden text-[0.625rem] text-accent sm:inline">
                  {t("open")}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    );

  return (
    <div className="space-y-8">
      {header}
      {featuredCard}
      {tagRail}
      {dropGrid}
      {densityStrip}
      {dispatchList}
    </div>
  );
}
