import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listChangelog, type ChangelogRow } from "@/lib/queries";
import { localeAlternates } from "@/lib/seo";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changelog" });
  return {
    alternates: {
      canonical: `/${locale}/changelog`,
      languages: localeAlternates("/changelog"),
    }, title: t("title"), description: t("subtitle") };
}

const KIND_COLORS: Record<string, string> = {
  badge_added: "var(--success)",
  badge_updated: "var(--info)",
  badge_removed: "var(--danger)",
  data_sync: "var(--muted)",
  feature: "var(--accent)",
  bugfix: "var(--warning)",
  blog: "var(--accent)",
  push: "var(--info)",
};

export default async function ChangelogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { locale } = await params;
  const [sp] = await Promise.all([searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("changelog");

  const kind = sp.kind;
  const entries = await listChangelog(kind, 150).catch(() => []);

  const kinds = [
    "all",
    "badge_added",
    "badge_updated",
    "badge_removed",
    "data_sync",
    "feature",
    "bugfix",
    // Both kinds exist in the data and have translations, but had no filter
    // chip, so those entries could not be selected.
    "blog",
    "push",
  ];

  const filterHref = (value: string) =>
    value === "all" ? "/changelog" : `/changelog?kind=${value}`;

  // Group by calendar day.
  const groups = new Map<string, ChangelogRow[]>();
  for (const entry of entries) {
    const day = new Date(entry.created_at).toLocaleDateString(locale, {
      dateStyle: "long",
    });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(entry);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route serving XML, not a page */}
        <a
          href="/api/changelog/rss"
          className="btn btn-secondary text-xs"
          title={t("rss")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="6.5" cy="17.5" r="2.5" />
            <path d="M4 4a16 16 0 0 1 16 16h-3A13 13 0 0 0 4 7z" />
            <path d="M4 10a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z" />
          </svg>
          RSS
        </a>
      </header>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("all")}>
        {kinds.map((value) => (
          <Link
            key={value}
            href={filterHref(value)}
            className={`chip ${(!kind && value === "all") || kind === value ? "chip-active" : ""}`}
          >
            {t(value === "all" ? "all" : (value as "feature"))}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">{t("empty")}</div>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([day, dayEntries]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted">
                {day}
              </h2>
              <ol className="space-y-2">
                {dayEntries.map((entry) => (
                  <li key={entry.id} className="card flex gap-3 p-4">
                    <span
                      aria-hidden
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: KIND_COLORS[entry.kind] ?? "var(--muted)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">{entry.title}</p>
                        <time
                          dateTime={entry.created_at}
                          className="shrink-0 font-mono text-[0.6875rem] text-muted tabular-nums"
                        >
                          {new Date(entry.created_at).toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                      </div>
                      {entry.body && (
                        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
                          {entry.body}
                        </p>
                      )}
                      <span className="mt-1.5 inline-block text-[0.625rem] font-semibold uppercase tracking-wide text-muted/70">
                        {t(entry.kind as "feature")}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
