import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSiteStats } from "@/lib/queries";
import { daySeries, getPlatformStats } from "@/lib/stats";
import { ACH_BY_ID } from "@/lib/gamification/achievements";
import { GAMES } from "@/lib/gamification/games";
import { levelTheme } from "@/lib/gamification/levels";
import BadgeGrid from "@/components/badges/BadgeGrid";
import RarityChip from "@/components/badges/RarityChip";
import { RARITY_COLORS, RARITY_TIERS, type RarityTier } from "@/lib/rarity";
import { formatCompact } from "@/components/badges/BadgeCard";
import Coin from "@/components/Coin";
import CountUp from "@/components/stats/CountUp";
import Reveal from "@/components/stats/Reveal";
import TrendChart from "@/components/stats/TrendChart";
import DonutChart from "@/components/stats/DonutChart";
import DistributionBars from "@/components/stats/DistributionBars";
import LevelHistogram from "@/components/stats/LevelHistogram";
import UptimeGauge from "@/components/stats/UptimeGauge";
import UptimeCalendar from "@/components/stats/UptimeCalendar";
import AvailabilityStrip from "@/components/stats/AvailabilityStrip";
import LiveStatus from "@/components/stats/LiveStatus";
import { localeAlternates } from "@/lib/seo";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "stats" });
  return {
    alternates: {
      canonical: `/${locale}/stats`,
      languages: localeAlternates("/stats"),
    }, title: t("title"), description: t("subtitle") };
}

/** Solid palette for SVG charts (presentation attributes cannot resolve var()). */
const PALETTE: Record<string, string> = {
  xp: "#a970ff",
  daily: "#34d399",
  badge_claim: "#fbbf24",
  wheel: "#60a5fa",
  game: "#f472b6",
  achievement: "#fbbf24",
  steal: "#f87171",
  steal_defended: "#fb923c",
  level_up: "#60a5fa",
  turbo_win: "#fde047",
  coin_rain: "#34d399",
  profile: "#c084fc",
  first_login: "#9aa0b0",
  rps: "#a970ff",
  slots: "#fbbf24",
  shoot: "#f472b6",
  memory: "#60a5fa",
  quiz: "#34d399",
  coinflip: "#c084fc",
  hilo: "#fb923c",
  roulette: "#f87171",
  blackjack: "#9aa0b0",
  vault: "#22d3ee",
  scratch: "#facc15",
  tower: "#818cf8",
  catcher: "#4ade80",
};

const LEVEL_BUCKETS = 10;

const ICONS = {
  users: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  spark: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    </svg>
  ),
  coin: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
    </svg>
  ),
  dice: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  trophy: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
    </svg>
  ),
  pulse: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </svg>
  ),
};

function relativeTime(value: string | null, locale: string): string {
  if (!value) return "—";
  const diff = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60_000) return formatter.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), "hour");
  return formatter.format(Math.round(diff / 86_400_000), "day");
}

function Kpi({
  label,
  value,
  hint,
  decimals = 0,
  locale,
  accent,
  icon,
  coin,
}: {
  label: string;
  value: number | null;
  hint?: string;
  decimals?: number;
  locale: string;
  accent?: string;
  icon?: ReactNode;
  coin?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="flex items-start justify-between gap-2">
        <div className="kpi-value" style={accent ? { color: accent } : undefined}>
          {value === null ? (
            "—"
          ) : (
            <CountUp value={value} locale={locale} decimals={decimals} />
          )}
          {coin ? <Coin size={14} className="ms-1.5" /> : null}
        </div>
        {icon ? <span className="kpi-icon">{icon}</span> : null}
      </div>
      <div className="kpi-label">{label}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}

function SectionHead({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2 id={id} className="scroll-mt-24">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export default async function StatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("stats");
  const tr = await getTranslations("rarity");
  const tf = await getTranslations("feed");

  const [catalog, platform] = await Promise.all([
    getSiteStats().catch(() => null),
    getPlatformStats(),
  ]);

  // "now" anchors the 30-day calendar; the page revalidates every 5 minutes.
  // eslint-disable-next-line react-hooks/purity -- async server component
  const now = Date.now();
  const number = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // One-decimal formatter for percentages: `toFixed(1)` always emits "." and
  // would show "12.3%" in locales whose separator is ",".
  const decimal1 = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const game = platform.gamification;
  const uptime = platform.uptime;

  const xpTrend = daySeries(platform.dailyXp, 30).map((row) => ({
    label: row.label,
    xp: row.xp ?? 0,
    coins: row.coins ?? 0,
    events: row.events ?? 0,
  }));

  const userTrend = daySeries(platform.dailyUsers, 30).map((row) => ({
    label: row.label,
    users: row.count ?? 0,
  }));

  const badgeTrend = daySeries(platform.dailyBadges, 30).map((row) => ({
    label: row.label,
    badges: row.count ?? 0,
  }));

  const kindRows = platform.activityKinds
    .filter((row) => row.events > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 8);

  const donutSlices = kindRows.map((row) => ({
    key: row.kind,
    label: tf(row.kind),
    value: row.xp,
    color: PALETTE[row.kind] ?? "#9aa0b0",
  }));

  const levelBuckets = Array.from({ length: LEVEL_BUCKETS }, (_, index) => {
    const from = index * 10 + 1;
    const to = from + 9;
    const inBucket = platform.levels.filter(
      (row) => row.level >= from && row.level <= to,
    );
    return {
      key: `${from}`,
      label: `${from}–${to}`,
      value: inBucket.reduce((total, row) => total + row.players, 0),
      hint: `${formatCompact(inBucket.reduce((total, row) => total + row.xp, 0), locale)} XP`,
      color: levelTheme(Math.round((from + to) / 2)).glow,
    };
  });

  const gameRows = platform.games.map((row) => {
    const meta = GAMES.find((entry) => entry.id === row.game);
    const winRate = row.rounds > 0 ? (row.wins / row.rounds) * 100 : 0;
    return {
      key: row.game,
      label: meta?.title ?? row.game,
      value: row.rounds,
      hint: `${decimal1.format(winRate)}%`,
      color: PALETTE[row.game] ?? "#a970ff",
    };
  });

  const achievementTotals = platform.achievements.reduce(
    (totals, row) => {
      totals.unlocks += row.unlocks;
      if (row.category === "common") totals.common += row.unlocks;
      else if (row.category === "creative") totals.creative += row.unlocks;
      else if (row.category === "special") totals.special += row.unlocks;
      return totals;
    },
    { unlocks: 0, common: 0, creative: 0, special: 0 },
  );

  const catalogTotals = { common: 0, creative: 0, special: 0 };
  for (const achievement of ACH_BY_ID.values()) {
    catalogTotals[achievement.category] += 1;
  }
  const achievementCatalogSize =
    catalogTotals.common + catalogTotals.creative + catalogTotals.special;

  const rarest = [...platform.achievements]
    .filter((row) => row.category !== "other")
    .sort((a, b) => a.unlocks - b.unlocks)
    .slice(0, 8);

  const categoryRows = [
    {
      key: "common",
      label: t("categoryCommon"),
      value: achievementTotals.common,
      hint: `${catalogTotals.common}`,
      color: "#34d399",
    },
    {
      key: "creative",
      label: t("categoryCreative"),
      value: achievementTotals.creative,
      hint: `${catalogTotals.creative}`,
      color: "#a970ff",
    },
    {
      key: "special",
      label: t("categorySpecial"),
      value: achievementTotals.special,
      hint: `${catalogTotals.special}`,
      color: "#fbbf24",
    },
  ];

  // Internal heartbeat ids key the uptime aggregation and must stay as they are,
  // but the table used to print them verbatim — publishing provider names on a
  // public page. Display goes through neutral, localized labels instead, and an
  // id with no label falls back to a generic one rather than to the raw internal
  // name, so adding a source cannot leak a provider name by accident.
  const SOURCE_LABELS: Record<string, string> = {
    "cron/global": t("sourceCronGlobal"),
    "cron/badgebase": t("sourceCronEnrichment"),
    "cron/potat": t("sourceCronOwners"),
    "sync/global": t("sourceSyncCatalog"),
    "sync/badgebase": t("sourceSyncEnrichment"),
    "sync/potat": t("sourceSyncOwners"),
    web: t("sourceWeb"),
  };
  const sourceLabel = (id: string) => SOURCE_LABELS[id] ?? t("sourceOther");

  // The raw `source` id is destructured away on purpose: it keys the aggregation
  // upstream, but on a public page it otherwise survives in the serialized
  // payload (it did, as the row key) even after the visible cell became a
  // neutral label. Every other field is passed through untouched.
  const uptimeSources = uptime.sources.map((entry, index) => {
    const { source: rawId, ...rest } = entry;
    void rawId;
    return {
      ...rest,
      key: `${index}-${sourceLabel(entry.source)}`,
      label: sourceLabel(entry.source),
      rate24h:
        entry.checks_24h > 0 ? (entry.ok_24h / entry.checks_24h) * 100 : null,
      rate7d: entry.checks_7d > 0 ? (entry.ok_7d / entry.checks_7d) * 100 : null,
    };
  });

  const calendarCells = (() => {
    const byDay = new Map<
      string,
      { checks: number; ok: number; errors: number; ms: number[] }
    >();
    for (const row of uptime.daily) {
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
                bucket.ms.reduce((total, value) => total + value, 0) / bucket.ms.length,
              )
            : null,
      });
    }
    return cells;
  })();

  const statusTone =
    uptime.status === "operational"
      ? "ok"
      : uptime.status === "degraded"
        ? "degraded"
        : "down";
  const statusLabel =
    uptime.status === "operational"
      ? t("statusOperational")
      : uptime.status === "degraded"
        ? t("statusDegraded")
        : t("statusDown");

  const navItems = [
    { href: "#economy", label: t("navEconomy") },
    { href: "#levels", label: t("navLevels") },
    { href: "#games", label: t("navGames") },
    { href: "#achievements", label: t("navAchievements") },
    { href: "#uptime", label: t("navUptime") },
    { href: "#traffic", label: t("navTraffic") },
    { href: "#catalog", label: t("navCatalog") },
  ];

  const systemRows: Array<[string, number]> = platform.system
    ? [
        ["badges", platform.system.badges],
        ["badge_stats", platform.system.badge_stat_rows],
        ["badge_events", platform.system.badge_events],
        ["profiles", platform.system.profiles],
        ["user_inventory", platform.system.inventory_rows],
        ["activity_events", platform.system.activity_events],
        ["game_rounds", platform.system.game_rounds],
        ["steal_attempts", platform.system.steal_attempts],
        ["user_achievements", platform.system.achievement_unlocks],
        ["changelog", platform.system.changelog_entries],
        ["blog_posts", platform.system.blog_posts],
        ["notifications", platform.system.notifications],
        ["push_subscriptions", platform.system.push_subscriptions],
        ["system_heartbeats", platform.system.heartbeats],
      ]
    : [];

  const freshnessRows: Array<[string, string | null]> = [
    [t("catalogLastSeen"), platform.system?.badges_last_seen ?? null],
    [t("catalogLastPolled"), platform.system?.badges_last_polled ?? null],
    [t("lastActivityAt"), platform.system?.last_activity ?? null],
    [t("lastChangeAt"), platform.system?.last_change ?? null],
    [t("lastPostAt"), platform.system?.last_post ?? null],
  ];

  return (
    <div className="space-y-12">
      {/* ---------------------------------------------------- hero */}
      <section className="stats-hero">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`status-pill status-${statusTone}`}>
            <span className="status-dot" aria-hidden />
            {statusLabel}
          </span>
          <span className="text-xs text-muted">
            {t("lastUpdate")}: {relativeTime(uptime.lastHeartbeat, locale)}
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t("subtitle")}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label={t("players")}
            value={game?.players ?? 0}
            hint={`${number.format(game?.active7d ?? 0)} ${t("activeWeek")}`}
            locale={locale}
            icon={ICONS.users}
          />
          <Kpi
            label={t("totalXp")}
            value={game?.totalXp ?? 0}
            hint={`${t("avgLevel")} ${decimal.format(game?.avgLevel ?? 0)}`}
            locale={locale}
            accent="var(--accent)"
            icon={ICONS.spark}
          />
          <Kpi
            label={t("totalCoins")}
            value={game?.totalCoins ?? 0}
            hint={`${number.format(game?.coinsWon ?? 0)} ${t("coinsWon")}`}
            locale={locale}
            coin
            accent="#fbbf24"
            icon={ICONS.coin}
          />
          <Kpi
            label={t("gamesPlayed")}
            value={game?.gamesPlayed ?? 0}
            hint={`${number.format(game?.gamesWon ?? 0)} ${t("gamesWon")}`}
            locale={locale}
            icon={ICONS.dice}
          />
          <Kpi
            label={t("achievementsUnlocked")}
            value={achievementTotals.unlocks}
            hint={`${achievementCatalogSize} ${t("achievementsTotal")}`}
            locale={locale}
            icon={ICONS.trophy}
          />
          <Kpi
            label={t("availabilityAll")}
            // No data must read as "—", not as a 0.00 % outage.
            value={uptime.availabilityAll}
            decimals={2}
            hint={`${number.format(
              uptime.sources.reduce((total, source) => total + source.checks_total, 0),
            )} ${t("checks")}`}
            locale={locale}
            accent="var(--success)"
            icon={ICONS.pulse}
          />
        </div>

        <nav className="stats-nav mt-6" aria-label={t("title")}>
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </section>

      {/* ---------------------------------------------------- economy */}
      <section id="economy" className="scroll-mt-24 space-y-4">
        <SectionHead
          id="economy-head"
          title={t("economyTitle")}
          subtitle={t("economySubtitle")}
        />

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("xpTrend")}</div>
                  <div className="chart-sub">{t("xpTrendSub")}</div>
                </div>
                <div className="chart-legend">
                  <span>
                    <span className="swatch" style={{ background: PALETTE.xp }} />
                    {t("legendXp")}
                  </span>
                  <span>
                    <span className="swatch" style={{ background: "#fbbf24" }} />
                    {t("legendCoins")}
                  </span>
                </div>
              </div>
              <TrendChart
                data={xpTrend}
                ariaLabel={t("xpTrend")}
                series={[
                  { key: "xp", label: t("legendXp"), color: PALETTE.xp },
                  { key: "coins", label: t("legendCoins"), color: "#fbbf24" },
                ]}
              />
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="chart-card h-full">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("xpSources")}</div>
                  <div className="chart-sub">{t("xpSourcesSub")}</div>
                </div>
              </div>
              <DonutChart
                data={donutSlices}
                ariaLabel={t("xpSources")}
                centerValue={formatCompact(game?.totalXp ?? 0, locale)}
                centerLabel={t("legendXp")}
              />
              <ul className="mt-3 space-y-1.5">
                {kindRows.map((row) => (
                  <li
                    key={row.kind}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex items-center text-muted">
                      <span
                        className="swatch"
                        style={{ background: PALETTE[row.kind] ?? "#9aa0b0" }}
                      />
                      {tf(row.kind)}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {number.format(row.xp)} XP
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label={t("coinsWon")} value={game?.coinsWon ?? 0} locale={locale} coin />
          <Kpi label={t("coinsLost")} value={game?.coinsLost ?? 0} locale={locale} coin />
          <Kpi
            label={t("coinsStolen")}
            value={platform.steals?.coins_stolen ?? 0}
            hint={`${number.format(platform.steals?.successes ?? 0)} / ${number.format(
              platform.steals?.attempts ?? 0,
            )}`}
            locale={locale}
            coin
          />
          <Kpi
            label={t("wheelSpins")}
            value={platform.wheel?.spins ?? 0}
            hint={`${number.format(platform.wheel?.spins_today ?? 0)} / 24h`}
            locale={locale}
          />
          <Kpi
            label={t("badgeClaims")}
            value={platform.claims?.claims ?? 0}
            hint={`${formatCompact(platform.claims?.claim_xp ?? 0, locale)} XP`}
            locale={locale}
          />
          <Kpi
            label={t("turboWins")}
            value={platform.wheel?.turbo_wins ?? 0}
            hint={t("turboOdds")}
            locale={locale}
            accent="#fde047"
          />
        </div>
      </section>

      {/* ---------------------------------------------------- levels */}
      <section id="levels" className="scroll-mt-24 space-y-4">
        <SectionHead id="levels-head" title={t("levelTitle")} subtitle={t("levelSubtitle")} />

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("levelHistogram")}</div>
                  <div className="chart-sub">{t("levelHistogramSub")}</div>
                </div>
              </div>
              <LevelHistogram buckets={levelBuckets} ariaLabel={t("levelHistogram")} />
              <div className="mt-3 flex justify-between text-[11px] text-muted">
                <span>1</span>
                <span>100</span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="chart-card h-full">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("topPlayers")}</div>
                  <div className="chart-sub">{t("topPlayersSub")}</div>
                </div>
                <Link
                  href="/leaderboards"
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  {t("allLeaderboards")} →
                </Link>
              </div>
              {platform.topPlayers.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">{t("noDataYet")}</p>
              ) : (
                <ol>
                  {platform.topPlayers.slice(0, 10).map((player, index) => (
                    <li
                      key={player.username}
                      className="rank-row"
                      style={{ "--d": `${index * 45}ms` } as CSSProperties}
                    >
                      <span className="rank-index">{index + 1}</span>
                      {player.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={player.avatar_url}
                          alt=""
                          width={24}
                          height={24}
                          className="size-6 rounded-full"
                        />
                      ) : (
                        <span className="size-6 rounded-full bg-surface-3" />
                      )}
                      <Link
                        href={`/profile/${player.username}`}
                        className="min-w-0 flex-1 truncate text-xs font-semibold hover:text-accent"
                      >
                        {player.username}
                      </Link>
                      <span className="text-[11px] text-muted">L{player.level}</span>
                      <span className="w-16 text-end text-xs font-bold tabular-nums">
                        {formatCompact(player.xp, locale)}
                      </span>
                      <span className="hidden w-16 text-end text-[11px] tabular-nums text-muted sm:block">
                        {formatCompact(player.coins, locale)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- games */}
      <section id="games" className="scroll-mt-24 space-y-4">
        <SectionHead id="games-head" title={t("gamesTitle")} subtitle={t("gamesSubtitle")}>
          <Link href="/games" className="text-xs font-semibold text-accent hover:underline">
            {t("playNow")} →
          </Link>
        </SectionHead>

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("gameRounds")}</div>
                  <div className="chart-sub">{t("gameRoundsSub")}</div>
                </div>
                <div className="chart-legend">
                  <span>{t("rounds")}</span>
                  <span>{t("winRate")}</span>
                </div>
              </div>
              {gameRows.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">{t("noDataYet")}</p>
              ) : (
                <DistributionBars rows={gameRows} locale={locale} labelWidth="9rem" />
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="metric-chip">
                  {t("wagered")}
                  <b>
                    {formatCompact(
                      platform.games.reduce((total, row) => total + row.wagered, 0),
                      locale,
                    )}
                  </b>
                </span>
                <span className="metric-chip">
                  {t("paidOut")}
                  <b>
                    {formatCompact(
                      platform.games.reduce((total, row) => total + row.paid_out, 0),
                      locale,
                    )}
                  </b>
                </span>
                <span className="metric-chip">
                  {t("biggestWin")}
                  <b>
                    {formatCompact(
                      platform.games.reduce(
                        (peak, row) => Math.max(peak, row.biggest_win),
                        0,
                      ),
                      locale,
                    )}
                  </b>
                </span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="chart-card h-full">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("hallOfFame")}</div>
                  <div className="chart-sub">{t("hallOfFameSub")}</div>
                </div>
              </div>
              {platform.biggestWins.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">{t("noDataYet")}</p>
              ) : (
                <ol>
                  {platform.biggestWins.map((win, index) => (
                    <li
                      key={win.id}
                      className="rank-row"
                      style={{ "--d": `${index * 45}ms` } as CSSProperties}
                    >
                      <span className="rank-index">{index + 1}</span>
                      <Link
                        href={`/profile/${win.username}`}
                        className="min-w-0 flex-1 truncate text-xs font-semibold hover:text-accent"
                      >
                        {win.username}
                      </Link>
                      <span className="hidden truncate text-[11px] text-muted sm:block">
                        {GAMES.find((entry) => entry.id === win.game)?.title ?? win.game}
                      </span>
                      <span className="flex w-20 items-center justify-end gap-1 text-xs font-bold tabular-nums text-warning">
                        <Coin size={11} />
                        {formatCompact(win.payout, locale)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- achievements */}
      <section id="achievements" className="scroll-mt-24 space-y-4">
        <SectionHead id="achievements-head" title={t("achTitle")} subtitle={t("achSubtitle")}>
          <Link
            href="/achievements"
            className="text-xs font-semibold text-accent hover:underline"
          >
            {t("allAchievements")} →
          </Link>
        </SectionHead>

        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("achCategories")}</div>
                  <div className="chart-sub">{t("achCategoriesSub")}</div>
                </div>
              </div>
              <DistributionBars rows={categoryRows} locale={locale} />
              <p className="mt-3 text-xs text-muted">
                {number.format(achievementTotals.unlocks)} {t("unlocks")} ·{" "}
                {number.format(achievementCatalogSize)} {t("achievementsTotal")}
              </p>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("rarest")}</div>
                  <div className="chart-sub">{t("rarestSub")}</div>
                </div>
              </div>
              {rarest.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">{t("noDataYet")}</p>
              ) : (
                <ul>
                  {rarest.map((row, index) => {
                    const meta = ACH_BY_ID.get(row.achievement_id);
                    return (
                      <li
                        key={row.achievement_id}
                        className="rank-row"
                        style={{ "--d": `${index * 45}ms` } as CSSProperties}
                      >
                        <span className="rank-index">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">
                            {meta?.title ?? row.achievement_id}
                          </span>
                          <span className="block truncate text-[11px] text-muted">
                            {meta?.description ?? ""}
                          </span>
                        </span>
                        <span className="text-xs font-bold tabular-nums">
                          {number.format(row.unlocks)}
                        </span>
                        <span className="hidden w-16 text-end text-[11px] text-muted sm:block">
                          {row.category === "special"
                            ? t("categorySpecial")
                            : row.category === "creative"
                              ? t("categoryCreative")
                              : t("categoryCommon")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- uptime */}
      <section id="uptime" className="scroll-mt-24 space-y-4">
        <SectionHead id="uptime-head" title={t("uptimeTitle")} subtitle={t("uptimeSubtitle")} />

        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("availability")}</div>
                  <div className="chart-sub">{t("availabilitySub")}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-around gap-4">
                <UptimeGauge
                  value={uptime.availability24h}
                  caption="24h"
                  size={112}
                  stroke={9}
                  locale={locale}
                />
                <UptimeGauge
                  value={uptime.availability7d}
                  caption="7d"
                  size={112}
                  stroke={9}
                  delay={120}
                  locale={locale}
                />
                <UptimeGauge
                  value={uptime.availability30d}
                  caption="30d"
                  size={112}
                  stroke={9}
                  delay={240}
                  locale={locale}
                />
                <UptimeGauge
                  value={uptime.availabilityAll}
                  caption={t("total")}
                  size={112}
                  stroke={9}
                  delay={360}
                  locale={locale}
                />
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <LiveStatus
                  labels={{
                    online: t("liveOnline"),
                    degraded: t("liveDegraded"),
                    offline: t("liveOffline"),
                    checking: t("liveChecking"),
                    response: t("liveResponse"),
                    database: t("liveDatabase"),
                    region: t("liveRegion"),
                    environment: t("liveEnvironment"),
                    history: t("liveHistory"),
                    lastCheck: t("liveLastCheck"),
                    refresh: t("liveRefresh"),
                  }}
                />
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="chart-card h-full space-y-5">
              <div>
                <div className="chart-head">
                  <div>
                    <div className="chart-title">{t("hourlyStrip")}</div>
                    <div className="chart-sub">{t("hourlyStripSub")}</div>
                  </div>
                </div>
                <AvailabilityStrip
                  hours={uptime.hourly}
                  locale={locale}
                  emptyLabel={t("noData")}
                />
                <div className="mt-1.5 flex justify-between text-[10px] text-muted">
                  <span>−48h</span>
                  <span>0h</span>
                </div>
              </div>

              <div className="border-t border-line pt-5">
                <div className="chart-head">
                  <div>
                    <div className="chart-title">{t("calendar")}</div>
                    <div className="chart-sub">{t("calendarSub")}</div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted">
                    <span className="uptime-cell uptime-0 size-3" />
                    <span className="uptime-cell uptime-1 size-3" />
                    <span className="uptime-cell uptime-2 size-3" />
                    <span className="uptime-cell uptime-3 size-3" />
                    <span className="uptime-cell uptime-4 size-3" />
                  </div>
                </div>
                <UptimeCalendar
                  cells={calendarCells}
                  locale={locale}
                  labels={{
                    noData: t("noData"),
                    runs: t("runs"),
                    failures: t("failures"),
                    avg: t("avg"),
                  }}
                />
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal>
          <div className="chart-card overflow-x-auto">
            <div className="chart-head">
              <div>
                <div className="chart-title">{t("uptimeSources")}</div>
                <div className="chart-sub">{t("uptimeSourcesSub")}</div>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("source")}</th>
                  <th>{t("lastRun")}</th>
                  <th>{t("lastStatus")}</th>
                  <th>Ø ms</th>
                  {/* The cells below are: run count (24h), then the success
                      rate for 24h and 7d. The headers read "24h / 7d / 30d",
                      so the percentages sat under the wrong labels. */}
                  <th>{t("checks")} 24h</th>
                  <th>24h %</th>
                  <th>7d %</th>
                </tr>
              </thead>
              <tbody>
                {uptimeSources.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-xs text-muted">
                      {t("noDataYet")}
                    </td>
                  </tr>
                ) : (
                  uptimeSources.map((source) => (
                    <tr key={source.key}>
                      <td className="text-[11px] font-semibold">
                        {source.label}
                      </td>
                      <td className="text-muted">{relativeTime(source.last_at, locale)}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            source.last_status === "error"
                              ? "status-down"
                              : source.last_status === "degraded"
                                ? "status-degraded"
                                : "status-ok"
                          }`}
                        >
                          <span className="status-dot" aria-hidden />
                          {source.last_status === "error"
                            ? t("statusDown")
                            : source.last_status === "degraded"
                              ? t("statusDegraded")
                              : t("statusOperational")}
                        </span>
                        {source.last_message ? (
                          <span
                            className="ms-2 text-[11px] text-danger"
                            title={source.last_message}
                          >
                            {source.last_message.slice(0, 40)}
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular-nums text-muted">
                        {source.avg_ms_24h !== null ? `${source.avg_ms_24h}` : "—"}
                      </td>
                      <td className="tabular-nums text-muted">
                        {number.format(source.checks_24h)}
                      </td>
                      <td className="tabular-nums font-semibold">
                        {source.rate24h === null ? "—" : `${decimal1.format(source.rate24h)}%`}
                      </td>
                      <td className="tabular-nums text-muted">
                        {source.rate7d === null ? "—" : `${decimal1.format(source.rate7d)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Reveal>

        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("dataFreshness")}</div>
                  <div className="chart-sub">{t("dataFreshnessSub")}</div>
                </div>
              </div>
              <ul className="space-y-2 text-xs">
                {freshnessRows.map(([label, value]) => (
                  <li key={label} className="flex items-center justify-between gap-3">
                    <span className="text-muted">{label}</span>
                    <span className="font-semibold">{relativeTime(value, locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("systemTitle")}</div>
                  <div className="chart-sub">{t("systemSubtitle")}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {systemRows.map(([label, value]) => (
                  <div key={label}>
                    <div className="text-lg font-extrabold tabular-nums">
                      <CountUp value={value} locale={locale} />
                    </div>
                    <div className="kpi-label">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- traffic */}
      <section id="traffic" className="scroll-mt-24 space-y-4">
        <SectionHead id="traffic-head" title={t("trafficTitle")} subtitle={t("trafficSubtitle")} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label={t("profileVisits")}
            value={platform.traffic?.profile_visits ?? 0}
            hint={`${number.format(platform.traffic?.profile_visits_7d ?? 0)} ${t("last7d")}`}
            locale={locale}
          />
          <Kpi
            label={t("profileViewsTotal")}
            value={platform.traffic?.profile_views_total ?? 0}
            locale={locale}
          />
          <Kpi
            label={t("blogViews")}
            value={platform.traffic?.blog_views ?? 0}
            hint={`${number.format(platform.traffic?.blog_views_7d ?? 0)} ${t("last7d")}`}
            locale={locale}
          />
          <Kpi
            label={t("blogReactions")}
            value={platform.traffic?.blog_reactions ?? 0}
            locale={locale}
          />
          <Kpi
            label={t("blogPosts")}
            value={platform.traffic?.blog_published ?? 0}
            hint={`${number.format(platform.traffic?.blog_posts ?? 0)} ${t("total")}`}
            locale={locale}
          />
          <Kpi
            label={t("coinRains")}
            value={platform.claims?.coin_rains ?? 0}
            hint={`${number.format(platform.claims?.daily_claims ?? 0)} ${t("dailyClaims")}`}
            locale={locale}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("growthUsers")}</div>
                  <div className="chart-sub">{t("growthUsersSub")}</div>
                </div>
              </div>
              <TrendChart
                data={userTrend}
                ariaLabel={t("growthUsers")}
                height={200}
                series={[{ key: "users", label: t("newUsers"), color: "#34d399" }]}
              />
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">{t("growthBadges")}</div>
                  <div className="chart-sub">{t("growthBadgesSub")}</div>
                </div>
              </div>
              <TrendChart
                data={badgeTrend}
                ariaLabel={t("growthBadges")}
                height={200}
                series={[{ key: "badges", label: t("newBadges"), color: "#fbbf24" }]}
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- catalog */}
      <section id="catalog" className="scroll-mt-24 space-y-6">
        <SectionHead
          id="catalog-head"
          title={t("catalogTitle")}
          subtitle={t("catalogSubtitle")}
        />

        {catalog ? (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: t("totalBadges"), value: catalog.totalBadges },
                { label: t("activeBadges"), value: catalog.active },
                { label: t("upcomingBadges"), value: catalog.upcoming },
                { label: t("expiredBadges"), value: catalog.expired },
                { label: t("freeBadges"), value: catalog.free },
                { label: t("paidBadges"), value: catalog.paid },
              ].map((tile) => (
                <div key={tile.label} className="card stat-tile">
                  <dd className="stat-value">
                    <CountUp value={tile.value} locale={locale} />
                  </dd>
                  <dt className="stat-label">{tile.label}</dt>
                </div>
              ))}
            </dl>

            <div className="grid gap-4 lg:grid-cols-2">
              <Reveal>
                <div className="chart-card">
                  <div className="chart-head">
                    <div>
                      <div className="chart-title">{t("rarityDistribution")}</div>
                      <div className="chart-sub">{t("rarityDistributionSub")}</div>
                    </div>
                  </div>
                  <DistributionBars
                    locale={locale}
                    rows={RARITY_TIERS.map((tier: RarityTier) => ({
                      key: tier,
                      label: tr(tier),
                      value: catalog.rarityDistribution[tier] ?? 0,
                      color: RARITY_COLORS[tier],
                    }))}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {RARITY_TIERS.map((tier) => (
                      <RarityChip key={tier} tier={tier} compact />
                    ))}
                  </div>
                </div>
              </Reveal>

              <Reveal delay={80}>
                <div className="chart-card">
                  <div className="chart-head">
                    <div>
                      <div className="chart-title">{t("categoryBreakdown")}</div>
                      <div className="chart-sub">{t("categoryBreakdownSub")}</div>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto pe-1">
                    <DistributionBars
                      locale={locale}
                      delayStep={40}
                      rows={[...catalog.categoryCounts]
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 18)
                        .map((row) => ({
                          key: row.category,
                          label: row.category,
                          value: row.count,
                        }))}
                    />
                  </div>
                </div>
              </Reveal>
            </div>

            <div>
              <div className="section-title">
                <h3 className="text-base font-bold">{t("newestBadges")}</h3>
                <Link
                  href="/badges"
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  {t("badges")} →
                </Link>
              </div>
              <BadgeGrid badges={catalog.newestBadges} showCountdown={false} />
            </div>
          </>
        ) : (
          <div className="card p-10 text-center text-sm text-muted">{t("noDataYet")}</div>
        )}
      </section>
    </div>
  );
}
