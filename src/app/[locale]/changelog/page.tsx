import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listChangelog, type ChangelogRow } from "@/lib/queries";
import { KIND_COLORS } from "@/lib/changelog-kinds";
import { localeAlternates } from "@/lib/seo";
import Reveal from "@/components/stats/Reveal";
import RiskChip from "@/components/changelog/RiskChip";

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
    },
    title: t("title"),
    description: t("subtitle"),
  };
}

const KINDS = [
  "all",
  "feature",
  "bugfix",
  "data_sync",
  "badge_added",
  "badge_updated",
  "badge_removed",
  "blog",
  "push",
] as const;

/** Kinds rendered as full "signal" cards in the Dispatch variant; the rest
 *  compresses to dispatch rows (they are high-volume, low-information). */
const SIGNAL_KINDS = new Set(["bugfix", "feature", "badge_added", "badge_removed", "blog", "push"]);

/* ------------------------------------------------------------------ */
/* Layout preview switch — stays until the owner picks the winner.     */
/* ------------------------------------------------------------------ */
const CHANGELOG_LAYOUTS = ["a", "b", "c", "d"] as const;
type ChangelogLayout = (typeof CHANGELOG_LAYOUTS)[number];

/**
 * Variant A "Ledger" is the live layout (owner decision 2026-09-30). The
 * Timeline/Dispatch/Registry variants below stay fully wired in this file,
 * hidden behind this flag — flip to true to re-preview them via ?layout=.
 */
const CHANGELOG_LAYOUT_PREVIEW = false;

function resolveLayout(value: unknown): ChangelogLayout {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" &&
    (CHANGELOG_LAYOUTS as readonly string[]).includes(single)
    ? (single as ChangelogLayout)
    : "a";
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string | string[]; layout?: string | string[] }>;
}

export default async function ChangelogPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const [sp] = await Promise.all([searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("changelog");

  const kindRaw = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind;
  const kindParam = kindRaw ?? "";
  const kind = (KINDS as readonly string[]).includes(kindParam) ? kindParam : "all";
  const layout = resolveLayout(sp.layout);

  // One unfiltered read powers the feed, the chip counts, the density strip
  // and the risk summaries — the kind filter is applied in-memory.
  const all = await listChangelog(undefined, 500).catch(() => []);
  const entries = kind === "all" ? all : all.filter((e) => e.kind === kind);

  const now = new Date();
  const monthCount = all.filter((e) => {
    const d = new Date(e.created_at);
    return (
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth()
    );
  }).length;
  const latest = all[0];
  const latestLabel = latest
    ? new Date(latest.created_at).toLocaleDateString(locale, { dateStyle: "medium" })
    : "—";
  const highRisk = all.filter((e) => e.risk === "high").length;

  const kindCount = (value: string) =>
    value === "all" ? all.length : all.filter((e) => e.kind === value).length;

  const fmtTime = (value: string) =>
    new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (value: string) =>
    new Date(value).toLocaleDateString(locale, { dateStyle: "long" });
  const fmtMonth = (value: string) =>
    new Date(value).toLocaleDateString(locale, { month: "long", year: "numeric" });

  const filterHref = (value: string, layoutValue: string) => {
    const params = new URLSearchParams();
    // The layout param only means something while preview is enabled —
    // otherwise chips would keep propagating a dead ?layout= around.
    if (CHANGELOG_LAYOUT_PREVIEW && layoutValue !== "a") {
      params.set("layout", layoutValue);
    }
    if (value !== "all") params.set("kind", value);
    const qs = params.toString();
    return qs === "" ? "/changelog" : `/changelog?${qs}`;
  };

  /* ---------------------------------------------------------------- */
  /* Shared pieces                                                     */
  /* ---------------------------------------------------------------- */
  const riskChip = (entry: ChangelogRow, compact = false) => {
    const labelKey =
      entry.risk === "high" ? "riskHigh" : entry.risk === "medium" ? "riskMedium" : "riskLow";
    const hintKey =
      entry.risk === "high" ? "riskHighHint" : entry.risk === "medium" ? "riskMediumHint" : "riskLowHint";
    return (
      <RiskChip
        level={entry.risk}
        label={t(labelKey)}
        hint={t(hintKey)}
        compact={compact}
      />
    );
  };

  const kindDot = (entry: ChangelogRow) => (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: KIND_COLORS[entry.kind] ?? "var(--muted)" }}
    />
  );

  /** Owner's contract: a bugfix is ONE clear sentence (the title) with
   *  timestamp + risk on the sentence line; the body is clamped context. */
  const sentence = (entry: ChangelogRow) => (
    <p className={`cl-sentence ${entry.kind === "bugfix" ? "" : "font-bold"}`}>
      {entry.title}
    </p>
  );
  // Tailwind can't see runtime-computed class names, so the clamp line count
  // is selected explicitly.
  const bodyClamp = (entry: ChangelogRow, lines: 2 | 3) =>
    entry.body ? (
      <p
        className={`mt-1 text-[0.8125rem] leading-relaxed text-muted ${
          lines === 2 ? "line-clamp-2" : "line-clamp-3"
        }`}
      >
        {entry.body}
      </p>
    ) : null;

  const masthead = (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="bl-kpi">
          <b>{all.length.toLocaleString(locale)}</b>
          <span>{t("statEntries")}</span>
        </div>
        <div className="bl-kpi">
          <b>{monthCount.toLocaleString(locale)}</b>
          <span>{t("statMonth")}</span>
        </div>
        <div className="bl-kpi">
          <b className="text-sm">{latestLabel}</b>
          <span>{t("statLatest")}</span>
        </div>
        {highRisk > 0 && (
          <div className="bl-kpi" title={t("riskHigh")}>
            <b className="text-[var(--danger)]">{highRisk.toLocaleString(locale)}</b>
            <span>{t("riskHigh")}</span>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route serving XML, not a page */}
        <a href="/api/changelog/rss" className="btn btn-secondary btn-sm" title={t("rss")}>
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

  const filterRail = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterLabel")}>
        {KINDS.map((value) => (
          <Link
            key={value}
            href={filterHref(value, layout)}
            className={`chip ${kind === value ? "chip-active" : ""}`}
            aria-current={kind === value ? "true" : undefined}
          >
            {value === "all" ? t("all") : t(value as "feature")}
            <span className="ml-1 tabular-nums opacity-60">{kindCount(value)}</span>
          </Link>
        ))}
      </div>
      <p className="text-[0.6875rem] text-muted">
        {t("showing", {
          shown: entries.length.toLocaleString(locale),
          total: all.length.toLocaleString(locale),
        })}
      </p>
    </div>
  );

  const emptyState = (
    <div className="card p-10 text-center text-sm text-muted">
      {kind === "all" ? t("empty") : t("emptyFilter")}
    </div>
  );

  // Day groups (newest first), each entry keeps its list position for folios.
  const groups = new Map<string, ChangelogRow[]>();
  for (const entry of entries) {
    const day = fmtDay(entry.created_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(entry);
  }
  const dayGroups = [...groups.entries()];

  const monthOf = (value: string) => fmtMonth(value);
  const isNewMonth = (list: ChangelogRow[], i: number) =>
    i === 0 || monthOf(list[i].created_at) !== monthOf(list[i - 1].created_at);

  /* ---------------------------------------------------------------- */
  /* Variant A — "Ledger"                                              */
  /* ---------------------------------------------------------------- */
  const variantLedger = (
    <div className="space-y-8">
      {masthead}
      {filterRail}
      {entries.length === 0 ? (
        emptyState
      ) : (
        <div className="card overflow-hidden p-0">
          {entries.map((entry, i) => (
            <div key={entry.id}>
              {isNewMonth(entries, i) && (
                <div className="ledger-month">
                  <h3>{monthOf(entry.created_at)}</h3>
                  <span>
                    {t("riskMix", {
                      low: entries.filter((e) => monthOf(e.created_at) === monthOf(entry.created_at) && e.risk === "low").length,
                      medium: entries.filter((e) => monthOf(e.created_at) === monthOf(entry.created_at) && e.risk === "medium").length,
                      high: entries.filter((e) => monthOf(e.created_at) === monthOf(entry.created_at) && e.risk === "high").length,
                    })}
                  </span>
                </div>
              )}
              <div
                id={`changelog-${entry.id}`}
                className="grid scroll-mt-24 grid-cols-[2.5rem_1fr_auto] gap-x-3 px-3 py-2.5 sm:grid-cols-[3rem_6rem_1fr_5.5rem_2.5rem] sm:gap-x-4 sm:px-4"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}
              >
                <span className="wire-idx pt-0.5">
                  #{String(entries.length - i).padStart(3, "0")}
                </span>
                <span className="wire-time hidden pt-1 sm:block">
                  {new Date(entry.created_at).toISOString().slice(0, 10)}
                  <br />
                  {fmtTime(entry.created_at)}
                </span>
                <div className="min-w-0">
                  {sentence(entry)}
                  <div className="mt-0.5 flex items-center gap-2 sm:hidden">
                    {kindDot(entry)}
                    <span className="wire-mono text-[0.5625rem] text-muted">
                      {t(entry.kind as "feature")} · {fmtTime(entry.created_at)}
                    </span>
                  </div>
                  {bodyClamp(entry, 2)}
                </div>
                <span className="wire-mono hidden items-center gap-1.5 pt-1 text-[0.5625rem] text-muted sm:flex">
                  {kindDot(entry)}
                  {t(entry.kind as "feature")}
                </span>
                <span className="pt-0.5">{riskChip(entry, true)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Variant B — "Timeline"                                            */
  /* ---------------------------------------------------------------- */
  const variantTimeline = () => (
    <div className="space-y-8">
      {masthead}
      {filterRail}
      {entries.length === 0 ? (
        emptyState
      ) : (
        <div className="chron">
          <span className="chron-now">
            <span className="live-dot" aria-hidden="true" />
            <span className="sr-only">{fmtDay(now.toISOString())}</span>
          </span>
          {entries.map((entry, i) => (
            <Reveal key={entry.id} delay={Math.min(i, 12) * 30}>
              {isNewMonth(entries, i) && (
                <div className="chron-month">
                  <h3>{monthOf(entry.created_at)}</h3>
                </div>
              )}
              <div className="chron-item">
                <p className="chron-date">
                  {fmtDay(entry.created_at)} · {fmtTime(entry.created_at)}
                </p>
                <div
                  id={`changelog-${entry.id}`}
                  className="chron-entry card scroll-mt-24 p-3.5"
                  style={{ ["--entry-color" as string]: KIND_COLORS[entry.kind] ?? "var(--muted)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    {sentence(entry)}
                    {riskChip(entry)}
                  </div>
                  {bodyClamp(entry, 2)}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {kindDot(entry)}
                    <span className="wire-mono text-[0.5625rem] text-muted">
                      {t(entry.kind as "feature")}
                      {typeof entry.payload?.source === "string" &&
                        ` · ${t("source", { source: entry.payload.source })}`}
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Variant C — "Dispatch"                                            */
  /* ---------------------------------------------------------------- */
  const dayMap = new Map<string, ChangelogRow[]>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), []);
  }
  for (const entry of all) {
    const key = entry.created_at.slice(0, 10);
    if (dayMap.has(key)) dayMap.get(key)!.push(entry);
  }
  const maxDay = Math.max(1, ...[...dayMap.values()].map((v) => v.length));
  const level = (n: number) =>
    n === 0 ? "0" : n >= maxDay ? "max" : String(Math.min(3, n));

  const featuredEntry = entries[0];
  const variantDispatch = () => (
    <div className="space-y-8">
      {masthead}
      {featuredEntry ? (
        <Reveal>
          <section className="card p-6" aria-label={t("featured")}>
            <div className="cl-feature">
              <div className="cl-feature-glyph" aria-hidden="true">
                <span style={{ color: KIND_COLORS[featuredEntry.kind] ?? "var(--accent)" }}>
                  {featuredEntry.kind === "bugfix" ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                  ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 3" />
                    </svg>
                  )}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip pointer-events-none text-[0.5625rem] chip-active">
                    {t("featured")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {kindDot(featuredEntry)}
                    <span className="wire-mono text-[0.5625rem] text-muted">
                      {t(featuredEntry.kind as "feature")} · {fmtTime(featuredEntry.created_at)}
                    </span>
                  </span>
                  {riskChip(featuredEntry)}
                </div>
                <h2 className="mt-2.5 text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
                  {featuredEntry.title}
                </h2>
                {bodyClamp(featuredEntry, 3)}
              </div>
            </div>
          </section>
        </Reveal>
      ) : null}
      {filterRail}
      {entries.length === 0 ? (
        emptyState
      ) : (
        <>
          <section aria-label={t("wireDensity")} className="card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="wire-mono text-[0.6875rem] text-muted">{t("wireDensity")}</h2>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route serving XML, not a page */}
              <a href="/api/changelog/rss" className="wire-mono text-[0.625rem] text-muted hover:text-accent">
                {t("rss")}
              </a>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(1.6rem,1fr))] gap-1">
              {[...dayMap.entries()].map(([day, dayEntries]) =>
                dayEntries.length > 0 ? (
                  <Link
                    key={day}
                    href={`/changelog#changelog-${dayEntries[0].id}`}
                    className="bl-day-cell"
                    data-count={level(dayEntries.length)}
                    title={`${day} · ${dayEntries.length}`}
                  >
                    {dayEntries.length}
                    <span className="sr-only">{`${day} — ${dayEntries.length}`}</span>
                  </Link>
                ) : (
                  <span key={day} className="bl-day-cell" data-count="0" aria-hidden="true" />
                ),
              )}
            </div>
          </section>
          <div className="space-y-8">
            {dayGroups.map(([day, dayEntries]) => {
              const signals = dayEntries.filter((e) => SIGNAL_KINDS.has(e.kind));
              const noise = dayEntries.filter((e) => !SIGNAL_KINDS.has(e.kind));
              return (
                <section key={day} aria-label={day}>
                  <div className="cl-day-head">
                    <h3>{day}</h3>
                    <span className="wire-mono text-muted">
                      {signals.length}/{dayEntries.length} {t("signal")}
                    </span>
                  </div>
                  {signals.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {signals.map((entry) => (
                        <article
                          key={entry.id}
                          id={`changelog-${entry.id}`}
                          className="card scroll-mt-24 p-4"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            {sentence(entry)}
                            <time
                              dateTime={entry.created_at}
                              className="font-mono text-[0.6875rem] text-muted tabular-nums"
                            >
                              {fmtTime(entry.created_at)}
                            </time>
                          </div>
                          {bodyClamp(entry, 2)}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {riskChip(entry)}
                            <span className="flex items-center gap-1.5">
                              {kindDot(entry)}
                              <span className="wire-mono text-[0.5625rem] text-muted">
                                {t(entry.kind as "feature")}
                              </span>
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {noise.length > 0 && (
                    <div className={`card overflow-hidden p-0 ${signals.length > 0 ? "mt-3" : ""}`}>
                      <ol>
                        {noise.map((entry) => (
                          <li key={entry.id} id={`changelog-${entry.id}`} className="scroll-mt-24">
                            <span className="wire-row">
                              <span className="wire-time">{fmtTime(entry.created_at)}</span>
                              <span className="min-w-0 truncate text-sm text-muted">
                                {entry.title}
                              </span>
                              <span className="flex items-center gap-1.5">
                                {kindDot(entry)}
                                {riskChip(entry, true)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Variant D — "Registry"                                            */
  /* ---------------------------------------------------------------- */
  const ruling = entries.find((e) => e.kind === "bugfix") ?? entries[0];
  const variantRegistry = () => (
    <div className="space-y-8">
      <header className="space-y-4 text-center">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="bl-kpi">
            <b>{all.length.toLocaleString(locale)}</b>
            <span>{t("statEntries")}</span>
          </div>
          <div className="bl-kpi">
            <b>{monthCount.toLocaleString(locale)}</b>
            <span>{t("statMonth")}</span>
          </div>
          <div className="bl-kpi">
            <b className="text-sm">{latestLabel}</b>
            <span>{t("statLatest")}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route serving XML, not a page */}
          <a href="/api/changelog/rss" className="btn btn-secondary btn-sm">
            {t("rss")}
          </a>
        </div>
        <hr className="registry-rule" />
      </header>
      {filterRail}
      {ruling ? (
        <section className="bl-placard p-5" aria-label={t("featured")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip pointer-events-none text-[0.5625rem] chip-active">
              {t("featured")}
            </span>
            <span className="registry-dateline">
              {fmtDay(ruling.created_at)} · {fmtTime(ruling.created_at)} ·{" "}
              {t(ruling.kind as "feature")}
            </span>
            {riskChip(ruling)}
          </div>
          <h2 className="mt-2 text-xl font-extrabold leading-tight tracking-tight">
            {ruling.title}
          </h2>
          {bodyClamp(ruling, 3)}
        </section>
      ) : null}
      {entries.length === 0 ? (
        emptyState
      ) : (
        <div>
          {entries.map((entry, i) => (
            <div key={entry.id}>
              {isNewMonth(entries, i) && (
                <div className="registry-issue">
                  <h3>{monthOf(entry.created_at)}</h3>
                </div>
              )}
              <article
                id={`changelog-${entry.id}`}
                className="registry-entry scroll-mt-24"
              >
                <span className="registry-dateline">
                  {new Date(entry.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}{" "}
                  · {fmtTime(entry.created_at)} · {t(entry.kind as "feature")}
                </span>
                {riskChip(entry, true)}
                <span className="registry-sentence">{entry.title}</span>
                {bodyClamp(entry, 2)}
              </article>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {CHANGELOG_LAYOUT_PREVIEW
        ? layout === "b"
          ? variantTimeline()
          : layout === "c"
            ? variantDispatch()
            : layout === "d"
              ? variantRegistry()
              : variantLedger
        : variantLedger}
    </div>
  );
}
