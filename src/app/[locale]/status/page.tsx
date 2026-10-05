import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getUptimeSnapshot, pipelineSources, type UptimeSource } from "@/lib/stats";
import { listChangelog, type ChangelogRow } from "@/lib/queries";
import { localeAlternates } from "@/lib/seo";
import Reveal from "@/components/stats/Reveal";
import UptimeGauge from "@/components/stats/UptimeGauge";
import UptimeCalendar from "@/components/stats/UptimeCalendar";
import AvailabilityStrip from "@/components/stats/AvailabilityStrip";
import LiveStatus from "@/components/stats/LiveStatus";
import RiskChip from "@/components/changelog/RiskChip";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "status" });
  return {
    alternates: {
      canonical: `/${locale}/status`,
      languages: localeAlternates("/status"),
    },
    title: t("title"),
    description: t("subtitle"),
  };
}

/* ------------------------------------------------------------------ */
/* Layout preview switch — stays until the owner picks the winner.     */
/* ------------------------------------------------------------------ */
const STATUS_LAYOUTS = ["a", "b", "c", "d"] as const;
type StatusLayout = (typeof STATUS_LAYOUTS)[number];

/**
 * Variant D "Dashboard" is the live layout (owner decision 2026-09-30). The
 * Classic/Timeline/Light variants below stay fully wired in this file,
 * hidden behind this flag — flip to true to re-preview them via ?layout=.
 */
const STATUS_LAYOUT_PREVIEW = false;

function resolveLayout(value: unknown): StatusLayout {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" &&
    (STATUS_LAYOUTS as readonly string[]).includes(single)
    ? (single as StatusLayout)
    : "a";
}

/** Static schedule knowledge (vercel.json + GitHub Actions offsets). */
interface ScheduleEntry {
  /** Heartbeat source id this schedule drives. */
  source: string;
  /** UTC hour/minute of the daily run, or the 15-minute grid for potat. */
  daily?: [number, number];
  every15?: boolean;
}
const SCHEDULE: ScheduleEntry[] = [
  { source: "cron/global", daily: [6, 0] },
  { source: "cron/badgebase", daily: [6, 5] },
  { source: "cron/potat", daily: [6, 30] },
  { source: "cron/potat", every15: true },
];

/** The sync/* heartbeat sources fire when their cron counterpart runs. */
const SCHEDULE_ALIAS: Record<string, string> = {
  "sync/global": "cron/global",
  "sync/badgebase": "cron/badgebase",
  "sync/potat": "cron/potat",
};

function nextRunMs(entry: ScheduleEntry, now: Date): number {
  if (entry.every15) {
    // GitHub Actions fires at :07/:22/:37/:52 to dodge the Vercel crons.
    const next = [7, 22, 37, 52].find((o) => o > now.getUTCMinutes());
    const candidate = new Date(now);
    if (next !== undefined) {
      candidate.setUTCMinutes(next, 0, 0);
    } else {
      candidate.setUTCHours(now.getUTCHours() + 1, 7, 0, 0);
    }
    return candidate.getTime() - now.getTime();
  }
  const [h, m] = entry.daily!;
  const candidate = new Date(now);
  candidate.setUTCHours(h, m, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.getTime() - now.getTime();
}

/**
 * Next run for a heartbeat source: the nearest of ALL its schedule entries
 * (cron/potat is both a 06:30 Vercel cron AND on the 15-minute grid — taking
 * only the first match showed "in 14h" while the next run was minutes away).
 */
function nextRunFor(source: string, now: Date): number | null {
  const target = SCHEDULE_ALIAS[source] ?? source;
  const entries = SCHEDULE.filter((s) => s.source === target);
  if (entries.length === 0) return null;
  return Math.min(...entries.map((entry) => nextRunMs(entry, now)));
}

// Minutes-first so rounding can never emit "1h 60m" at the hour boundary.
const msLabel = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** Engine identity of a data_sync changelog row from its title. */
function engineOf(title: string): string {
  if (title.includes("Catalog sync")) return "sync/global";
  if (title.includes("Drop-window")) return "sync/badgebase";
  if (title.includes("Stats sync")) return "sync/potat";
  return "";
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ layout?: string | string[] }>;
}

export default async function StatusPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const [sp] = await Promise.all([searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("status");
  const ts = await getTranslations("stats");
  const tc = await getTranslations("changelog");
  const layout = resolveLayout(sp.layout);

  const [uptime, syncFeedRaw, bugfixes] = await Promise.all([
    getUptimeSnapshot().catch(() => null),
    // 120 rows so the daily global/badgebase runs are still inside the window
    // next to potat's 96-per-day rows (variant D looks up each engine's
    // newest run; the timeline itself slices the newest 12).
    listChangelog("data_sync", 120).catch(() => [] as ChangelogRow[]),
    listChangelog("bugfix", 10).catch(() => [] as ChangelogRow[]),
  ]);
  const syncFeed = syncFeedRaw.slice(0, 12);
  // Incidents = bug fixes plus failed/skipped sync runs (risk high) — the
  // rows the risk column exists to surface. The high-risk syncs are already
  // in syncFeedRaw, so no extra query.
  const incidents = [...bugfixes, ...syncFeedRaw.filter((r) => r.risk === "high")]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 10);

  const now = new Date();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const relTime = (iso: string | null) => {
    if (!iso) return t("never");
    const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
    const diffH = Math.round(diffMin / 60);
    if (Math.abs(diffH) < 48) return rtf.format(diffH, "hour");
    return rtf.format(Math.round(diffH / 24), "day");
  };

  const status = uptime?.status ?? "operational";
  const statusTone =
    status === "operational" ? "ok" : status === "degraded" ? "degraded" : "down";
  const headline =
    status === "operational"
      ? t("allSystems")
      : status === "degraded"
        ? t("degradedTitle")
        : t("downTitle");

  // Neutral, localized source labels (same mapping as /stats — never print
  // provider names on a public page).
  const SOURCE_LABELS: Record<string, string> = {
    "cron/global": ts("sourceCronGlobal"),
    "cron/badgebase": ts("sourceCronEnrichment"),
    "cron/potat": ts("sourceCronOwners"),
    "sync/global": ts("sourceSyncCatalog"),
    "sync/badgebase": ts("sourceSyncEnrichment"),
    "sync/potat": ts("sourceSyncOwners"),
    web: ts("sourceWeb"),
  };
  const sourceLabel = (id: string) => SOURCE_LABELS[id] ?? ts("sourceOther");

  const recurring = (uptime?.sources ?? []).filter(
    (s) => !s.source.startsWith("manual/"),
  );
  const bySource = new Map((uptime?.sources ?? []).map((s) => [s.source, s]));

  const statusDot = (tone: string) => (
    <span
      className={`status-pill status-${tone}`}
      role="status"
    >
      <span className="status-dot" aria-hidden="true" />
      {ts(
        tone === "ok"
          ? "statusOperational"
          : tone === "degraded"
            ? "statusDegraded"
            : "statusDown",
      )}
    </span>
  );
  const sourceTone = (src: UptimeSource): "ok" | "degraded" | "down" =>
    src.last_status === "ok"
      ? "ok"
      : src.last_status === "degraded"
        ? "degraded"
        : "down";

  // 30-day calendar cells (aggregated across sources, same as /stats).
  const calendarCells = (() => {
    const byDay = new Map<
      string,
      { checks: number; ok: number; errors: number; ms: number[] }
    >();
    for (const row of uptime?.daily ?? []) {
      const key = row.day.slice(0, 10);
      const bucket = byDay.get(key) ?? { checks: 0, ok: 0, errors: 0, ms: [] };
      bucket.checks += row.checks;
      bucket.ok += row.ok;
      bucket.errors += row.errors;
      if (row.avg_ms !== null) bucket.ms.push(row.avg_ms);
      byDay.set(key, bucket);
    }
    const cells = [];
    for (let index = 29; index >= 0; index -= 1) {
      const date = new Date(now);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - index);
      const key = date.toISOString().slice(0, 10);
      const bucket = byDay.get(key);
      cells.push({
        day: key,
        checks: bucket?.checks ?? 0,
        ok: bucket?.ok ?? 0,
        errors: bucket?.errors ?? 0,
        avgMs:
          bucket && bucket.ms.length > 0
            ? Math.round(
                bucket.ms.reduce((total, value) => total + value, 0) /
                  bucket.ms.length,
              )
            : null,
      });
    }
    return cells;
  })();

  const gaugeRow = (
    <div className="flex flex-wrap items-center justify-around gap-4">
      <UptimeGauge value={uptime?.availability24h ?? null} caption="24h" size={112} stroke={9} locale={locale} />
      <UptimeGauge value={uptime?.availability7d ?? null} caption="7d" size={112} stroke={9} delay={120} locale={locale} />
      <UptimeGauge value={uptime?.availability30d ?? null} caption="30d" size={112} stroke={9} delay={240} locale={locale} />
      <UptimeGauge value={uptime?.availabilityAll ?? null} caption={ts("total")} size={112} stroke={9} delay={360} locale={locale} />
    </div>
  );

  const calendarCard = (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{t("activity")}</div>
          <div className="chart-sub">{ts("uptimeSourcesSub")}</div>
        </div>
      </div>
      <UptimeCalendar
        cells={calendarCells}
        locale={locale}
        labels={{
          noData: ts("noData"),
          runs: ts("runs"),
          failures: ts("failures"),
          avg: ts("avg"),
        }}
      />
    </div>
  );

  const stripCard = (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{ts("hourlyStrip")}</div>
          <div className="chart-sub">{ts("hourlyStripSub")}</div>
        </div>
      </div>
      <AvailabilityStrip
        hours={uptime?.hourly ?? []}
        locale={locale}
        emptyLabel={ts("noData")}
      />
    </div>
  );

  const liveCard = (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{t("live")}</div>
          <div className="chart-sub">{t("liveSub")}</div>
        </div>
      </div>
      <LiveStatus
        labels={{
          online: ts("liveOnline"),
          degraded: ts("liveDegraded"),
          offline: ts("liveOffline"),
          checking: ts("liveChecking"),
          response: ts("liveResponse"),
          database: ts("liveDatabase"),
          region: ts("liveRegion"),
          environment: ts("liveEnvironment"),
          history: ts("liveHistory"),
          lastCheck: ts("liveLastCheck"),
          refresh: ts("liveRefresh"),
        }}
      />
    </div>
  );

  const incidentList = (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{t("incidents")}</div>
          <div className="chart-sub">{t("incidentsSub")}</div>
        </div>
        <Link href="/changelog?kind=bugfix" className="btn btn-secondary btn-sm">
          {t("viewChangelog")}
        </Link>
      </div>
      {incidents.length === 0 ? (
        <p className="text-sm text-muted">{t("noIncidents")}</p>
      ) : (
        <ol className="space-y-2">
          {incidents.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0 last:pb-0"
            >
              <Link
                href={`/changelog#changelog-${entry.id}`}
                className="min-w-0 flex-1 text-sm font-semibold leading-snug hover:text-accent"
              >
                {entry.title}
              </Link>
              <span className="flex shrink-0 items-center gap-2">
                <span className="wire-mono text-[0.5625rem] text-muted">
                  {relTime(entry.created_at)}
                </span>
                <RiskChip
                  level={entry.risk}
                  label={tc(entry.risk === "high" ? "riskHigh" : entry.risk === "medium" ? "riskMedium" : "riskLow")}
                  hint={tc(entry.risk === "high" ? "riskHighHint" : entry.risk === "medium" ? "riskMediumHint" : "riskLowHint")}
                  compact
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const scheduleCard = (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{t("schedule")}</div>
          <div className="chart-sub">{t("scheduleSub")}</div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {SCHEDULE.map((entry, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="text-muted">
              {sourceLabel(entry.source)}
              {entry.every15 ? ` · 15′` : ""}
            </span>
            <span className="wire-mono text-[0.625rem] text-muted tabular-nums">
              {entry.every15
                ? ":07 :22 :37 :52"
                : `${String(entry.daily![0]).padStart(2, "0")}:${String(entry.daily![1]).padStart(2, "0")} UTC`}
              {" → "}
              {t("in", { time: msLabel(nextRunMs(entry, now)) })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  const sourceCard = (src: UptimeSource) => {
    const rate = src.checks_24h > 0 ? Math.round((src.ok_24h / src.checks_24h) * 100) : null;
    const next = nextRunFor(src.source, now);
    return (
      <div className="card p-4" key={src.source}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold">{sourceLabel(src.source)}</span>
          {statusDot(sourceTone(src))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.8125rem]">
          <dt className="text-muted">{t("lastRun")}</dt>
          <dd className="text-end tabular-nums">{relTime(src.last_at)}</dd>
          <dt className="text-muted">{t("duration")}</dt>
          <dd className="text-end tabular-nums">
            {src.last_ms == null ? "—" : `${(src.last_ms / 1000).toFixed(1)}s`}
          </dd>
          <dt className="text-muted">{t("rate24h")}</dt>
          <dd className="text-end tabular-nums">
            {rate === null ? "—" : `${rate}%`}
          </dd>
          {next !== null && (
            <>
              <dt className="text-muted">{t("nextRun")}</dt>
              <dd className="text-end tabular-nums">
                {t("in", { time: msLabel(next) })}
              </dd>
            </>
          )}
        </dl>
        {src.last_status && src.last_status !== "ok" && src.last_message && (
          <p className="mt-2 truncate text-xs text-muted" title={src.last_message}>
            {src.last_message}
          </p>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Variant A — "Classic": hero + service grid + gauges               */
  /* ---------------------------------------------------------------- */
  const variantClassic = () => (
    <div className="space-y-8">
      <section className="hero-box">
        <div className="hero-box-inner flex flex-wrap items-center justify-between gap-4 p-6 sm:p-8">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {statusDot(statusTone)}
              <span className="text-sm font-semibold">{headline}</span>
              <span className="text-xs text-muted">
                {t("heartbeat")} {relTime(uptime?.lastHeartbeat ?? null)}
              </span>
            </div>
          </div>
          <div className="w-full max-w-xs">{liveCard}</div>
        </div>
      </section>

      <section aria-label={t("sources")} className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
          {t("sources")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recurring.map((src) => sourceCard(src))}
        </div>
      </section>

      <Reveal>
        <section className="chart-card" aria-label={t("availability")}>
          <div className="chart-head">
            <div>
              <div className="chart-title">{t("availability")}</div>
              <div className="chart-sub">{ts("availabilitySub")}</div>
            </div>
          </div>
          {gaugeRow}
        </section>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal>{calendarCard}</Reveal>
        <Reveal delay={120}>{stripCard}</Reveal>
      </div>

      {scheduleCard}
      {incidentList}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Variant B — "Timeline": sync runs on a rail + side rail           */
  /* ---------------------------------------------------------------- */
  const timelineItems = syncFeed.map((entry) => {
    const engine = engineOf(entry.title);
    const src = engine ? bySource.get(engine) : undefined;
    return { entry, engine, src };
  });
  const variantTimeline = () => (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
          <div className="mt-2 flex items-center gap-3">
            {statusDot(statusTone)}
            <span className="text-xs text-muted">
              {t("heartbeat")} {relTime(uptime?.lastHeartbeat ?? null)}
            </span>
          </div>
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <section className="chron">
            <span className="chron-now">
              <span className="live-dot" aria-hidden="true" />
              <span className="sr-only">{t("syncFeed")}</span>
            </span>
            {timelineItems.length === 0 ? (
              <p className="text-sm text-muted">{t("noSyncs")}</p>
            ) : (
              timelineItems.map(({ entry, engine, src }, i) => {
                const failed =
                  entry.payload?.failed === true ||
                  entry.payload?.allDetailsFailed === true;
                const duration =
                  src && src.last_ms && src.last_ms > 0
                    ? ` · ${(src.last_ms / 1000).toFixed(1)}s`
                    : "";
                return (
                <Reveal key={entry.id} delay={Math.min(i, 8) * 40}>
                  <div className="chron-item">
                    <p className="chron-date">
                      {relTime(entry.created_at)}
                      {duration}
                    </p>
                    <div
                      className="chron-entry card scroll-mt-24 p-3.5"
                      style={{
                        ["--entry-color" as string]: failed
                          ? "var(--danger)"
                          : entry.payload?.skipped
                            ? "var(--warning)"
                            : "var(--success)",
                      }}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="cl-sentence">
                          {engine ? sourceLabel(engine) : entry.title}
                        </p>
                        {failed ? (
                          <span className="chip chip-danger pointer-events-none text-[0.5625rem]">
                            {ts("statusDown")}
                          </span>
                        ) : null}
                      </div>
                      {entry.body && (
                        <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-muted">
                          {entry.body}
                        </p>
                      )}
                    </div>
                  </div>
                </Reveal>
                );
              })
            )}
          </section>
          {incidentList}
        </div>
        <aside className="space-y-6">
          {liveCard}
          {calendarCard}
          {stripCard}
          {scheduleCard}
        </aside>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Variant C — "Single light": one giant status light                */
  /* ---------------------------------------------------------------- */
  const lastIncident = incidents[0];
  const variantLight = () => (
    <div className="space-y-8">
      <section className="card relative overflow-hidden p-10 text-center" aria-label={t("title")}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              statusTone === "ok"
                ? "radial-gradient(60% 80% at 50% 0%, color-mix(in srgb, var(--success) 14%, transparent), transparent 70%)"
                : statusTone === "degraded"
                  ? "radial-gradient(60% 80% at 50% 0%, color-mix(in srgb, var(--warning) 16%, transparent), transparent 70%)"
                  : "radial-gradient(60% 80% at 50% 0%, color-mix(in srgb, var(--danger) 18%, transparent), transparent 70%)",
          }}
          aria-hidden="true"
        />
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <div className="mt-6 flex justify-center">{statusDot(statusTone)}</div>
        <p className="mt-3 text-xl font-extrabold tracking-tight">{headline}</p>
        <p className="mt-2 text-sm text-muted">
          {t("availability30")}{" "}
          <b className="tabular-nums">
            {uptime?.availability30d == null
              ? "—"
              : `${uptime.availability30d.toFixed(2)}%`}
          </b>{" "}
          · {t("heartbeat")} {relTime(uptime?.lastHeartbeat ?? null)}
        </p>
        <p className="mt-1 text-xs text-muted">
          {lastIncident
            ? `${t("lastIncident")}: ${lastIncident.title} (${relTime(lastIncident.created_at)})`
            : t("noIncidents")}
        </p>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal>{calendarCard}</Reveal>
        <Reveal delay={120}>{stripCard}</Reveal>
      </div>
      <section className="card overflow-hidden p-0" aria-label={t("sources")}>
        <ol>
          {recurring.map((src) => {
            const next = nextRunFor(src.source, now);
            return (
              <li key={src.source} className="wire-row">
                {/* .wire-row expects [idx][time][label][meta] — a placeholder
                    keeps the label out of the narrow index column. */}
                <span className="wire-idx" aria-hidden="true" />
                <span className="wire-time">{relTime(src.last_at)}</span>
                <span className="min-w-0 truncate text-sm font-semibold">
                  {sourceLabel(src.source)}
                </span>
                <span className="wire-mono text-[0.5625rem] text-accent">
                  {src.checks_24h > 0
                    ? `${Math.round((src.ok_24h / src.checks_24h) * 100)}% · `
                    : ""}
                  {next !== null ? t("in", { time: msLabel(next) }) : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
      {liveCard}
      {incidentList}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Variant D — "Dashboard": KPI tiles + engine cards                 */
  /* ---------------------------------------------------------------- */
  const engines = ["sync/global", "sync/badgebase", "sync/potat"];
  const variantDashboard = (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {statusDot(statusTone)}
            <span className="text-sm font-semibold">{headline}</span>
            <span className="text-xs text-muted">
              {t("heartbeat")} {relTime(uptime?.lastHeartbeat ?? null)}
            </span>
          </div>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("availability")}>
        <div className="bl-kpi"><b>{uptime?.availability24h == null ? "—" : `${uptime.availability24h.toFixed(1)}%`}</b><span>24h</span></div>
        <div className="bl-kpi"><b>{uptime?.availability7d == null ? "—" : `${uptime.availability7d.toFixed(1)}%`}</b><span>7d</span></div>
        <div className="bl-kpi"><b>{uptime?.availability30d == null ? "—" : `${uptime.availability30d.toFixed(1)}%`}</b><span>30d</span></div>
        <div className="bl-kpi"><b>{uptime?.availabilityAll == null ? "—" : `${uptime.availabilityAll.toFixed(1)}%`}</b><span>{ts("total")}</span></div>
        <div className="bl-kpi"><b>{pipelineSources(uptime?.sources ?? []).reduce((n, s) => n + s.checks_24h, 0).toLocaleString(locale)}</b><span>{t("checks24h")}</span></div>
        <div className="bl-kpi"><b className="text-sm">{relTime(uptime?.lastHeartbeat ?? null)}</b><span>{t("heartbeat")}</span></div>
      </section>
      {uptime?.recapClicks7d != null && (
        <p className="text-xs text-muted">{t("recapImpact", { n: uptime.recapClicks7d.toLocaleString(locale) })}</p>
      )}
      {uptime?.freezeCirculation != null && uptime?.freezeSaves7d != null && (
        <p className="text-xs text-muted">
          {t("freezeLine", {
            circulation: uptime.freezeCirculation.toLocaleString(locale),
            saves: uptime.freezeSaves7d.toLocaleString(locale),
          })}
        </p>
      )}
      <section className="grid gap-4 md:grid-cols-3" aria-label={t("sources")}>
        {engines.map((engine) => {
          const src = bySource.get(engine);
          const rate30 =
            src && src.checks_30d > 0 ? (src.ok_30d / src.checks_30d) * 100 : null;
          // Full 120-row window (syncFeedRaw) — potat's 96 rows/day would push
          // the daily runs out of a 12-row slice.
          const last = syncFeedRaw.find((e) => engineOf(e.title) === engine);
          return (
            <div className="chart-card" key={engine}>
              <div className="chart-head">
                <div>
                  <div className="chart-title">{sourceLabel(engine)}</div>
                  <div className="chart-sub">
                    {src ? relTime(src.last_at) : t("never")}
                  </div>
                </div>
                {src ? statusDot(sourceTone(src)) : null}
              </div>
              <div className="flex items-center justify-center">
                <UptimeGauge
                  value={rate30}
                  caption="30d"
                  size={96}
                  stroke={8}
                  locale={locale}
                />
              </div>
              {last?.body && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">
                  {last.body}
                </p>
              )}
            </div>
          );
        })}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal>{calendarCard}</Reveal>
        <Reveal delay={120}>{stripCard}</Reveal>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {scheduleCard}
        {liveCard}
      </div>
      {incidentList}
    </div>
  );

  return (
    <div className="space-y-6">
      {STATUS_LAYOUT_PREVIEW
        ? layout === "a"
          ? variantClassic()
          : layout === "b"
            ? variantTimeline()
            : layout === "c"
              ? variantLight()
              : variantDashboard
        : variantDashboard}
    </div>
  );
}
