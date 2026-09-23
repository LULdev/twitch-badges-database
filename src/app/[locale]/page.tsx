import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getHomeData } from "@/lib/queries";
import BadgeGrid from "@/components/badges/BadgeGrid";
import { formatCompact } from "@/components/badges/BadgeCard";
import LiveRefresher from "@/components/LiveRefresher";
import TwitchLoginButton from "@/components/TwitchLoginButton";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tc = await getTranslations("common");

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

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface px-6 py-14 text-center shadow-card sm:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full bg-accent/10 blur-3xl"
        />
        <h1 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight sm:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          {t("heroSubtitle")}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/badges" className="btn btn-primary px-6 py-3 text-sm">
            {t("ctaExplore")}
          </Link>
          <TwitchLoginButton
            label={t("ctaLogin")}
            className="btn btn-secondary px-6 py-3 text-sm"
          />
        </div>

        <dl className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="card stat-tile">
              <dd className="stat-value">{formatCompact(stat.value, locale)}</dd>
              <dt className="stat-label">{stat.label}</dt>
            </div>
          ))}
        </dl>
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
                {data.latestChangelog.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                    <div>
                      <p className="font-medium leading-snug">{entry.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(entry.created_at).toLocaleString(locale)}
                      </p>
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
