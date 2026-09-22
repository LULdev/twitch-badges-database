import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBadgebaseListing,
  fetchBadgebaseDetail,
  type BadgebaseCard,
} from "@/lib/twitch/badgebase";
import {
  guessCategory,
  isStatusSetId,
  resolveStatus,
} from "@/lib/twitch/types";
import { logChange } from "@/lib/changelog";

export interface BadgebaseSyncSummary {
  activeCards: number;
  upcomingCards: number;
  enriched: number;
  inserted: number;
  demotedToExpired: number;
  errors: number;
}

const BADGE_UUID = /badges\/v1\/([0-9a-f-]{36})/i;

function extractUuid(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = BADGE_UUID.exec(url);
  return match ? match[1] : null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ item: T; result: R | null }>> {
  const results: Array<{ item: T; result: R | null }> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { item: items[index], result: await fn(items[index]) };
        } catch {
          results[index] = { item: items[index], result: null };
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Authoritative drop-status sync from badgebase.de's curated listings:
 *   /active   → currently redeemable (status 'active' + is_confirmed_active)
 *   /upcoming → announced, pre-release (status 'upcoming')
 * Every badge NOT on the active list and without a live claim window is
 * demoted to 'expired' — only genuinely redeemable badges stay "active".
 * End dates (countdown expiry) and how-to-earn steps come from the detail
 * pages.
 */
export async function runBadgebaseSync(): Promise<BadgebaseSyncSummary> {
  const supabase = createAdminClient();

  const [activeCards, upcomingCards] = await Promise.all([
    fetchBadgebaseListing("/active"),
    fetchBadgebaseListing("/upcoming/"),
  ]);
  // The /active listing is the authority for "currently redeemable". An empty
  // listing — a provider hiccup, not a real state of the world — would clear
  // is_confirmed_active on every row and demote every dateless badge to expired.
  if (activeCards.length === 0) {
    throw new Error(
      "drop-window listing is empty — refusing to clear confirmations and demote badges",
    );
  }

  const cards = [...activeCards, ...upcomingCards].filter(
    (card) => !isStatusSetId(card.slug),
  );

  // Politeness: cap detail fetches per run, small concurrency pool.
  const capped = cards.slice(0, 45);
  const detailed = await mapLimit(capped, 4, (card) =>
    fetchBadgebaseDetail(`/b/${card.badgeId}-${card.slug}/`),
  );

  const allBadges = await supabase
    .from("badges")
    .select("*")
    .then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });

  const byUuid = new Map<string, Record<string, unknown>>();
  const bySetId = new Map<string, Record<string, unknown>>();
  for (const row of allBadges) {
    const uuid = extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    if (uuid) byUuid.set(uuid, row);
    if (!bySetId.has(row.set_id as string)) bySetId.set(row.set_id as string, row);
  }

  const now = new Date();
  let enriched = 0;
  let inserted = 0;
  let demotedToExpired = 0;
  let errors = 0;

  // Keys confirmed active by the /active listing (uuid or set_id).
  const activeKeys = new Set<string>();
  for (const card of activeCards) {
    if (card.imageUuid) activeKeys.add(card.imageUuid);
    activeKeys.add(card.slug);
  }

  for (const { item: card, result: detail } of detailed) {
    if (!detail) {
      errors += 1;
      continue;
    }
    const existing =
      (card.imageUuid ? byUuid.get(card.imageUuid) : undefined) ??
      bySetId.get(card.slug);

    const startDate =
      detail.startDate ??
      (card.startTs ? new Date(card.startTs * 1000).toISOString() : null);
    const endDate = detail.endDate;
    const isPaid = card.tags.includes("paid")
      ? true
      : card.tags.includes("free")
        ? false
        : null;
    const howToEarn = detail.howToEarn;
    const releaseDate = startDate;
    const confirmedActive = card.status === "active";

    if (existing) {
      const patch: Record<string, unknown> = {};
      // Compare against the stored value directly, null included: when a
      // detail page stops publishing a date (window extended, bogus end
      // removed) the stale value must be cleared, or the row keeps expiring on
      // a date upstream no longer publishes.
      if (startDate !== existing.start_date) patch.start_date = startDate;
      if (endDate !== existing.end_date) patch.end_date = endDate;
      if (releaseDate !== existing.release_date)
        patch.release_date = releaseDate;
      if (isPaid !== null && isPaid !== existing.is_paid)
        patch.is_paid = isPaid;
      if (howToEarn && howToEarn !== existing.how_to_earn)
        patch.how_to_earn = howToEarn;
      if (
        detail.description &&
        detail.description !== existing.description
      ) {
        patch.description = detail.description;
      }
      if ((existing.is_confirmed_active as boolean | null) !== confirmedActive) {
        patch.is_confirmed_active = confirmedActive;
      }
      const status = confirmedActive
        ? "active"
        : resolveStatus(
            {
              // The patch above owns these values now (null included), so the
              // status must resolve from the same values the row will carry.
              start_date: startDate,
              end_date: endDate,
              is_confirmed_active: confirmedActive,
            },
            now,
          );
      if (existing.status === "removed") {
        // The /active listing is the authoritative activity source: a card
        // still listed here was never really gone — the global key-based sweep
        // removed it because its set_id is a badgebase slug, not Twitch's.
        patch.status = status;
        patch.removed_at = null;
      } else if (status !== existing.status) {
        patch.status = status;
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase
          .from("badges")
          .update(patch)
          .eq("id", existing.id);
        if (error) throw error;
        enriched += 1;
      }
      continue;
    }

    // Unknown to the catalog: a badgebase announcement — usually an upcoming
    // drop before Twitch exposes it globally, or a fresh active one.
    const { error } = await supabase.from("badges").upsert(
      {
        set_id: card.slug,
        version: "1",
        slug: `${card.slug}-v1`,
        title: card.title ?? card.slug,
        description: detail.description,
        image_url_1x: card.imageUrl,
        image_url_2x: card.imageUrl,
        image_url_4x: card.imageUrl,
        category: guessCategory(card.slug),
        is_paid: isPaid ?? false,
        how_to_earn: howToEarn,
        start_date: startDate,
        end_date: endDate,
        release_date: releaseDate,
        status: confirmedActive
          ? "active"
          : resolveStatus({ start_date: startDate, end_date: endDate }, now),
        is_confirmed_active: confirmedActive,
        source: "badgebase",
        first_seen_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      },
      { onConflict: "set_id,version", ignoreDuplicates: true },
    );
    if (error) throw error;
    inserted += 1;
  }

  // Sweep: every badge NOT confirmed by the /active listing and without a
  // live window is demoted to 'expired' (permanent badges included).
  const sweepRows: Array<Record<string, unknown>> = [];
  for (const row of allBadges) {
    const keyUuid = extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (keyUuid ? activeKeys.has(keyUuid) : false);

    if (row.status === "removed") {
      // Only resurrect what the /active listing vouches for; a genuinely gone
      // badge stays removed. This also recovers rows outside the detail cap.
      if (!onActiveList) continue;
      sweepRows.push({
        ...row,
        is_confirmed_active: true,
        status: "active",
        removed_at: null,
      });
      continue;
    }
    if (onActiveList) continue;

    const confirmed = false;
    const nextStatus = resolveStatus(
      {
        start_date: row.start_date as string | null,
        end_date: row.end_date as string | null,
        is_confirmed_active: confirmed,
      },
      now,
    );
    if (row.status !== nextStatus || (row.is_confirmed_active as boolean)) {
      sweepRows.push({
        ...row,
        is_confirmed_active: confirmed,
        status: nextStatus,
      });
      if (nextStatus === "expired" && row.status !== "expired") {
        demotedToExpired += 1;
      }
    }
  }
  for (let i = 0; i < sweepRows.length; i += 200) {
    const { error } = await supabase
      .from("badges")
      .upsert(sweepRows.slice(i, i + 200), { onConflict: "set_id,version" });
    if (error) throw error;
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Drop-window listing sync completed",
      body: `${activeCards.length} active + ${upcomingCards.length} upcoming cards processed, ${enriched} badges enriched, ${inserted} new badges inserted, ${demotedToExpired} badges demoted to expired, ${errors} detail fetch errors.`,
      payload: {
        activeCards: activeCards.length,
        upcomingCards: upcomingCards.length,
        enriched,
        inserted,
        demotedToExpired,
        errors,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  // A resolved summary is recorded as a healthy heartbeat, so a total detail
  // outage — every card's fetch failed, no badge got a real claim window —
  // would show green. Surface it as a failure instead.
  if (capped.length > 0 && errors === capped.length) {
    throw new Error(
      `badgebase: all ${errors} detail fetches failed — treating the run as failed`,
    );
  }

  return {
    activeCards: activeCards.length,
    upcomingCards: upcomingCards.length,
    enriched,
    inserted,
    demotedToExpired,
    errors,
  };
}
