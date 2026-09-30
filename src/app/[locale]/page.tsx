import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localeHtmlLang } from "@/i18n/routing";
import { siteUrl } from "@/lib/seo";
import { jsonLdScript } from "@/lib/jsonld";
import { KIND_COLORS } from "@/lib/changelog-kinds";
import { getHomeData } from "@/lib/queries";
import BadgeGrid from "@/components/badges/BadgeGrid";
import { BadgeImage } from "@/components/badges/BadgeImage";
import { formatCompact } from "@/components/badges/BadgeCard";
import LiveRefresher from "@/components/LiveRefresher";
import TwitchLoginButton from "@/components/TwitchLoginButton";

/** Small stroke-icon set for the hero feature list (no emojis, per house style). */
const HERO_FEATURE_ICONS = [
  // F1: live tracking — radar/pulse
  <svg key="f1" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5M12 4.5A7.5 7.5 0 0 0 4.5 12" />
    <path d="M12 1a11 11 0 0 1 11 11M12 1A11 11 0 0 0 1 12" opacity="0.45" />
  </svg>,
  // F2: rarity — gem
  <svg key="f2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3h10l4 6-9 12L3 9l4-6z" />
    <path d="M3 9h18M12 21 8.5 9l2-6M12 21 15.5 9l-2-6" opacity="0.55" />
  </svg>,
  // F3: play — gamepad
  <svg key="f3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.5l-1 4a3 3 0 0 1-5.2 1.1L14 16.5h-4l-1.7 2.1a3 3 0 0 1-5.2-1.1l-1-4A4.5 4.5 0 0 1 6.5 8z" />
    <path d="M8 11v3M6.5 12.5h3M15.5 11.5h.01M18 13.5h.01" />
  </svg>,
  // F4: collection profile — user + grid
  <svg key="f4" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.6-3 2.9-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    <rect x="15.5" y="5.5" width="5" height="5" rx="1" />
    <rect x="17" y="13" width="3.5" height="3.5" rx="1" opacity="0.55" />
  </svg>,
];

const HERO_FEATURE_KEYS = [
  { title: "heroF1Title", desc: "heroF1Desc" },
  { title: "heroF2Title", desc: "heroF2Desc" },
  { title: "heroF3Title", desc: "heroF3Desc" },
  { title: "heroF4Title", desc: "heroF4Desc" },
] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tc = await getTranslations("common");
  const tMeta = await getTranslations("meta");

  let data = null;
  try {
    data = await getHomeData();
  } catch (error) {
    // A database failure is NOT an empty catalog. This used to collapse into the
    // "catalog is empty, run the sync" hint plus four 0 tiles — a false
    // operational claim on a healthy installation. Mirrors the badges explorer.
    data = null;
    console.warn("[home] catalog load failed:", error);
  }

  // `null` (not 0) when the load failed, so the tiles read "—" instead of a number
  // the page does not actually have. formatCompact renders null as "—".
  const stats = [
    { label: t("statActive"), value: data ? data.counts.active : null },
    { label: t("statUpcoming"), value: data ? data.counts.upcoming : null },
    { label: t("statExpired"), value: data ? data.counts.expired : null },
    { label: t("statTotal"), value: data ? data.counts.total : null },
  ];

  return (
    <div className="space-y-12">
      <LiveRefresher />

      {/* Hero highlight box — one h1 per page; replaces the old plain hero. */}
      <section className="hero-box">
        {/* Sitelinks-searchbox eligibility: /badges?q= is a real search target. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: tMeta("siteTitle"),
              url: siteUrl(),
              inLanguage: localeHtmlLang[locale as keyof typeof localeHtmlLang] ?? locale,
              description: tMeta("siteDescription"),
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: `${siteUrl()}/${locale}/badges?q={search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <div className="hero-box-inner">
          <div className="grid items-center gap-10 p-6 sm:p-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="text-center lg:text-start">
              <span className="chip chip-live">
                <span className="live-dot" aria-hidden="true" />
                {t("heroEyebrow", { count: formatCompact(data ? data.counts.active : null, locale) })}
              </span>
              <h1 className="mx-auto mt-4 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-5xl lg:mx-0">
                {t("heroTitle")}
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base lg:mx-0">
                {t("heroSubtitle")}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                {/* Login is the primary action — the copy above sells it. */}
                <TwitchLoginButton
                  label={t("ctaLogin")}
                  className="btn btn-primary px-6 py-3 text-sm"
                />
                <Link href="/badges" className="btn btn-secondary px-6 py-3 text-sm">
                  {t("ctaExplore")}
                </Link>
              </div>

              <ul className="mx-auto mt-8 grid max-w-xl gap-4 text-start sm:grid-cols-2 lg:mx-0">
                {HERO_FEATURE_KEYS.map((feature, index) => (
                  <li key={feature.title} className="flex items-start gap-3">
                    <span className="hero-f-icon">{HERO_FEATURE_ICONS[index]}</span>
                    <div>
                      <p className="text-sm font-bold">{t(feature.title)}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">{t(feature.desc)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Collector's Orbit — real rarest badges circling the Twitch emblem. */}
            <div className="hero-orbit-wrap" aria-hidden="true">
              <div className="hero-orbit">
                {(data?.heroBadges ?? []).map((badge, index) => (
                  <div
                    key={badge.slug}
                    className="hero-orbit-item"
                    style={{ ["--a" as string]: `${(360 / Math.max(data?.heroBadges.length ?? 1, 1)) * index}deg` }}
                  >
                    <div className="hero-orbit-slot">
                      <div className="hero-orbit-counter" style={{ ["--d" as string]: `${index * 0.7}s` }}>
                        <BadgeImage badge={badge} size={40} alt="" className="hero-orbit-badge" loading="eager" />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="hero-emblem">
                  <span className="hero-emblem-halo" />
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                  </svg>
                </div>
                <span className="hero-ring hero-ring-a" />
                <span className="hero-ring hero-ring-b" />
              </div>
            </div>
          </div>

          <div className="border-t border-line px-6 py-8 sm:px-10">
            <dl className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="card stat-tile">
                  <dd className="stat-value">{formatCompact(stat.value, locale)}</dd>
                  <dt className="stat-label">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Ending soon */}
      {data && data.endingSoon.length > 0 && (
        <section aria-labelledby="ending-soon">
          <div className="section-title">
            <h2 id="ending-soon">{t("endingSoonTitle")}</h2>
            <Link href="/active?sort=ending" className="text-xs font-semibold text-accent hover:underline">
              {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
            </Link>
          </div>
          <BadgeGrid badges={data.endingSoon} />
        </section>
      )}

      {/* Upcoming */}
      {data && data.upcoming.length > 0 && (
        <section aria-labelledby="upcoming">
          <div className="section-title">
            <h2 id="upcoming">{t("upcomingTitle")}</h2>
            <Link href="/upcoming" className="text-xs font-semibold text-accent hover:underline">
              {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
            </Link>
          </div>
          <BadgeGrid badges={data.upcoming} showCountdown={false} />
        </section>
      )}

      {/* Newest */}
      {data && data.newest.length > 0 && (
        <section aria-labelledby="newest">
          <div className="section-title">
            <h2 id="newest">{t("newestTitle")}</h2>
            <Link href="/badges" className="text-xs font-semibold text-accent hover:underline">
              {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
            </Link>
          </div>
          <BadgeGrid badges={data.newest} showCountdown={false} />
        </section>
      )}

      {/* Rarest */}
      {data && data.rarest.length > 0 && (
        <section aria-labelledby="rarest">
          <div className="section-title">
            <h2 id="rarest">{t("rarestTitle")}</h2>
            <Link href="/leaderboards" className="text-xs font-semibold text-accent hover:underline">
              {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
            </Link>
          </div>
          <BadgeGrid badges={data.rarest} showCountdown={false} />
        </section>
      )}

      {/* Changelog + Blog */}
      {data && (data.latestChangelog.length > 0 || data.latestPosts.length > 0) && (
        <section className="grid gap-6 lg:grid-cols-2">
          {data.latestChangelog.length > 0 && (
            <div className="card p-5">
              <div className="section-title">
                <h2>{t("fromChangelog")}</h2>
                <Link href="/changelog" className="text-xs font-semibold text-accent hover:underline">
                  {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
                </Link>
              </div>
              <ul className="space-y-3">
                {data.latestChangelog.map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: KIND_COLORS[entry.kind] ?? "var(--muted)" }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/changelog#changelog-${entry.id}`}
                        className="font-medium leading-snug hover:text-accent"
                      >
                        {entry.title}
                      </Link>
                      <time
                        dateTime={entry.created_at}
                        className="mt-0.5 block text-xs text-muted"
                      >
                        {new Date(entry.created_at).toLocaleDateString(locale, { dateStyle: "medium" })}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.latestPosts.length > 0 && (
            <div className="card p-5">
              <div className="section-title">
                <h2>{t("fromBlog")}</h2>
                <Link href="/blog" className="text-xs font-semibold text-accent hover:underline">
                  {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
                </Link>
              </div>
              <ul className="space-y-3">
                {data.latestPosts.map((post) => (
                  <li key={post.id} className="text-sm">
                    <Link href={`/blog/${post.slug}`} className="font-medium leading-snug hover:text-accent">
                      {post.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {new Date(post.published_at).toLocaleDateString(locale)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {!data && (
        <section className="card border-danger/40 bg-danger/10 p-8 text-center">
          <p className="text-sm font-semibold text-danger">{tc("errorTitle")}</p>
          <p className="mt-1 text-sm text-muted">{tc("errorBody")}</p>
        </section>
      )}
    </div>
  );
}
