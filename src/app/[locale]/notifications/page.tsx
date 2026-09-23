import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listNotifications } from "@/lib/queries";
import PushToggle from "@/components/PushToggle";
import { localeAlternates } from "@/lib/seo";

// `Link` here is next-intl's, and it prepends the active locale to any local href
// (`localePrefix: "always"`) — so a notification stored as `/en/badges/x` rendered
// as `/en/en/badges/x` and every title in the feed 404'd. The sync now stores
// locale-less paths; this strips the prefix the rows written before that fix still
// carry, and leaves absolute URLs alone. The regex matches a whole first segment
// only, so `/badges/x` is untouched and `/en` alone becomes `/`.
const LOCALE_PREFIX = new RegExp(`^/(?:${routing.locales.join("|")})(?=/|$)`);

function notificationHref(url: string): string {
  if (!url.startsWith("/")) return url; // absolute or protocol-relative
  return url.replace(LOCALE_PREFIX, "") || "/";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "notifications" });
  return {
    alternates: {
      canonical: `/${locale}/notifications`,
      languages: localeAlternates("/notifications"),
    }, title: t("title"), robots: { index: false } };
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notifications");

  const feed = await listNotifications(30).catch(() => []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <section className="card p-6">
        <PushToggle />
      </section>

      <section aria-labelledby="feed">
        <div className="section-title">
          <h2 id="feed">{t("feed")}</h2>
        </div>
        {feed.length === 0 ? (
          <div className="card p-10 text-center text-sm text-muted">
            {t("feedEmpty")}
          </div>
        ) : (
          <ol className="space-y-2">
            {feed.map((entry) => (
              <li key={entry.id} className="card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">
                    {entry.url ? (
                      <Link
                        href={notificationHref(entry.url)}
                        className="hover:text-accent"
                      >
                        {entry.title}
                      </Link>
                    ) : (
                      entry.title
                    )}
                  </p>
                  <time
                    dateTime={entry.created_at}
                    className="text-xs text-muted tabular-nums"
                  >
                    {new Date(entry.created_at).toLocaleString(locale, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                {entry.body && (
                  <p className="mt-1 text-[0.8125rem] text-muted">{entry.body}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
