import type { BadgeRow } from "@/lib/queries";

/**
 * Per-badge FAQ generator.
 *
 * Every question and every answer is derived from the badge's own row, so two
 * badges never render the same FAQ: an expired TwitchCon drop and a permanent
 * Bits badge answer the same ten questions with completely different content.
 *
 * Two rules make this module safe to trust:
 *
 *  - **No invented numbers.** A missing owner count reads "not tracked", never
 *    0. The detail page once rendered "0 owners / —" for exactly this reason.
 *  - **One source of truth.** The caller receives the rendered strings once and
 *    renders the visible accordion AND the schema.org FAQPage from the same
 *    array, because a mismatch between them forfeits the rich result.
 */

/** A translator already bound to the `badgeFaq` namespace. */
export type FaqTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface FaqContext {
  locale: string;
  t: FaqTranslate;
  /** Live potat.app count, when that lookup succeeded. */
  liveUserCount?: number | null;
  livePercentage?: number | null;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface BadgeFaq {
  items: FaqItem[];
  jsonLd: Record<string, unknown>;
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Whole days between two dates, at least 1 for a same-day window. */
function windowDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

export function buildBadgeFaq(badge: BadgeRow, ctx: FaqContext): BadgeFaq {
  const { t, locale } = ctx;
  const title = badge.title;
  const start = formatDate(badge.start_date, locale);
  const end = formatDate(badge.end_date, locale);
  const polled = formatDate(badge.last_polled_at, locale);
  const days = windowDays(badge.start_date, badge.end_date);
  const items: FaqItem[] = [];

  const push = (qKey: string, aKey: string, values?: Record<string, string | number>) => {
    items.push({ q: t(qKey, { title }), a: t(aKey, { title, ...values }) });
  };

  /**
   * Append a second sentence to the answer just pushed. Used where a detail is
   * only sometimes available — a percentage next to a known count, a poll date
   * on a row that has one. Passing an empty placeholder into an ICU message
   * would render a dangling separator, so the optional part is a whole
   * separate message rather than an empty interpolation.
   */
  const pushDetail = (detailKey: string, values?: Record<string, string | number>) => {
    const last = items[items.length - 1];
    if (!last) return;
    last.a = `${last.a} ${t(detailKey, { title, ...values })}`;
  };

  // 1 — Is it still available? The single most-asked question on a badge page.
  if (badge.status === "active" && end) {
    push("q_status", "a_statusActiveUntil", { date: end });
  } else if (badge.status === "active") {
    push("q_status", "a_statusActivePermanent");
  } else if (badge.status === "upcoming" && start) {
    push("q_status", "a_statusUpcoming", { date: start });
  } else if (badge.status === "upcoming") {
    push("q_status", "a_statusUpcomingNoDate");
  } else if (badge.status === "removed") {
    push("q_status", "a_statusRemoved");
  } else {
    push("q_status", "a_statusExpired");
  }

  // 2 — The claim window itself, which is not the same question as availability.
  if (start && end && days !== null) {
    push("q_window", "a_windowBoth", { start, end, count: days });
  } else if (start) {
    push("q_window", "a_windowOpenEnded", { start });
  } else if (end) {
    push("q_window", "a_windowEndOnly", { end });
  } else {
    push("q_window", "a_windowUnknown");
  }

  // 3 — How to earn it. `how_to_earn` is the curated field; the description is
  // the fallback, and neither existing means we say so instead of improvising.
  if (badge.how_to_earn) {
    push("q_howToEarn", "a_howToEarnKnown", { how: badge.how_to_earn });
  } else if (badge.description) {
    push("q_howToEarn", "a_howToEarnFromDescription", { how: badge.description });
  } else {
    push("q_howToEarn", "a_howToEarnUnknown");
  }

  // 4 — Does it cost anything.
  push("q_cost", badge.is_paid ? "a_costPaid" : "a_costFree");

  // 5 — How many people own it.
  const owners =
    badge.owner_count !== null
      ? formatNumber(badge.owner_count, locale)
      : null;
  if (owners !== null) {
    push("q_owners", "a_ownersKnown", { count: owners });
    if (badge.percentage !== null && Number.isFinite(Number(badge.percentage))) {
      pushDetail("a_ownersPercent", { value: formatPercent(Number(badge.percentage), locale) });
    }
  } else if (ctx.liveUserCount != null && Number.isFinite(ctx.liveUserCount)) {
    push("q_owners", "a_ownersLiveOnly", {
      count: formatNumber(ctx.liveUserCount, locale),
    });
  } else {
    push("q_owners", "a_ownersUnknown");
  }

  // 6 — Why two different numbers are on this page at all.
  push("q_countDifference", "a_countDifference");

  // 7 — Rarity, in plain language rather than the raw index formula.
  // Flat key per tier (`tierCommon`, not `tier.common`): the message runtime
  // treats a dot as a namespace separator, so a dotted key would resolve
  // against the root and throw MISSING_MESSAGE.
  push("q_rarity", "a_rarity", {
    score: Math.round(badge.rarity_score),
    tier: t(`tier${badge.rarity_tier[0].toUpperCase()}${badge.rarity_tier.slice(1)}`),
  });

  // 8 — What the set id and version are for.
  push("q_setId", "a_setId", { setId: badge.set_id, version: badge.version });

  // 9 — How the site decides the status, so the badge is not a black box.
  push("q_howWeKnow", "a_howWeKnow");
  if (polled) pushDetail("a_polledAt", { date: polled });

  // 10 — Getting it onto your own channel.
  push("q_ownChannel", "a_ownChannel");

  return {
    items,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  };
}
