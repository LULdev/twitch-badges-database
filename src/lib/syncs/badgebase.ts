import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBadgebaseFeed,
  fetchBadgebaseDetail,
} from "@/lib/twitch/badgebase";
import {
  badgeSlug,
  badgeStatus,
  guessCategory,
} from "@/lib/twitch/types";
import { logChange } from "@/lib/changelog";

export interface BadgebaseSyncSummary {
  feedItems: number;
  enriched: number;
  inserted: number;
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
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Enrich the catalog with badgebase.de drop metadata (start/end windows,
 * free/paid, how-to-earn) and insert genuinely new upcoming badges that have
 * not appeared in the official catalog yet.
 */
export async function runBadgebaseSync(): Promise<BadgebaseSyncSummary> {
  const supabase = createAdminClient();
  const feed = await fetchBadgebaseFeed();

  // Respect the source: cap detail fetches and run a small concurrency pool.
  const recent = feed.slice(0, 40);
  const details = await mapLimit(recent, 4, async (item) => {
    try {
      return await fetchBadgebaseDetail(item.link);
    } catch (error) {
      console.warn(
        `[badgebase] detail failed for ${item.link}:`,
        error instanceof Error ? error.message : error,
      );
      return { startDate: null, endDate: null, tags: [] };
    }
  });

  const allBadges = await supabase
    .from("badges")
    .select("id,set_id,version,slug,image_url_1x,image_url_2x,start_date,end_date,is_paid,how_to_earn,status")
    .then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        set_id: string;
        version: string;
        slug: string;
        image_url_1x: string | null;
        image_url_2x: string | null;
        start_date: string | null;
        end_date: string | null;
        is_paid: boolean;
        how_to_earn: string | null;
        status: string;
      }>;
    });

  const byUuid = new Map<string, (typeof allBadges)[number]>();
  const bySetId = new Map<string, (typeof allBadges)[number]>();
  for (const row of allBadges) {
    const uuid = extractUuid(row.image_url_1x) ?? extractUuid(row.image_url_2x);
    if (uuid) byUuid.set(uuid, row);
    if (!bySetId.has(row.set_id)) bySetId.set(row.set_id, row);
  }

  let enriched = 0;
  let inserted = 0;
  const now = new Date();

  for (let i = 0; i < recent.length; i += 1) {
    const item = recent[i];
    const detail = details[i];
    const itemUuid = extractUuid(item.imageUrl);
    const existing =
      (itemUuid ? byUuid.get(itemUuid) : undefined) ??
      bySetId.get(item.slug ?? "");

    const startDate = detail.startDate;
    const endDate = detail.endDate;
    const isPaid = item.isPaid ?? null;
    const status = badgeStatus(
      { start_date: startDate, end_date: endDate },
      now,
    );

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (startDate && startDate !== existing.start_date)
        patch.start_date = startDate;
      if (endDate && endDate !== existing.end_date) patch.end_date = endDate;
      if (isPaid !== null && isPaid !== existing.is_paid)
        patch.is_paid = isPaid;
      if (
        item.requirements &&
        item.requirements !== existing.how_to_earn
      ) {
        patch.how_to_earn = item.requirements;
      }
      if (status !== existing.status && existing.status !== "removed") {
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

    // Unknown to the catalog: a badgebase drop announcement — often an
    // upcoming badge before Twitch exposes it globally. Insert as upcoming.
    const setId = item.slug ?? item.sourceId?.toString() ?? item.name;
    const slug = badgeSlug(setId, "1");
    const { error } = await supabase.from("badges").upsert(
      {
        set_id: setId,
        version: "1",
        slug,
        title: item.name,
        image_url_1x: item.imageUrl || null,
        image_url_2x: item.imageUrl || null,
        image_url_4x: item.imageUrl || null,
        category: guessCategory(setId),
        is_paid: isPaid ?? false,
        how_to_earn: item.requirements || null,
        start_date: startDate,
        end_date: endDate,
        release_date: startDate,
        status,
        source: "badgebase",
        first_seen_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      },
      { onConflict: "set_id,version", ignoreDuplicates: true },
    );
    if (error) throw error;
    inserted += 1;
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Badgebase drop sync completed",
      body: `${recent.length} feed items processed, ${enriched} badges enriched with drop windows, ${inserted} new upcoming badges inserted.`,
      payload: {
        feedItems: recent.length,
        enriched,
        inserted,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  return { feedItems: recent.length, enriched, inserted };
}
