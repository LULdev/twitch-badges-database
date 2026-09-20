import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBadgebaseListing,
  fetchBadgebaseDetail,
  type BadgebaseCard,
} from "@/lib/twitch/badgebase";
import { badgeStatus, guessCategory, isStatusSetId } from "@/lib/twitch/types";
import { logChange } from "@/lib/changelog";

export interface BadgebaseSyncSummary {
  activeCards: number;
  upcomingCards: number;
  enriched: number;
  insertedUpcoming: number;
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
 * Sync drop metadata from badgebase.de's curated listing pages:
 *   /active   → currently redeemable badges with availability windows
 *   /upcoming → announced badges, inserted as upcoming before Twitch
 *               exposes them globally
 * End dates (countdown expiry) and how-to-earn steps come from each badge's
 * detail page.
 */
export async function runBadgebaseSync(): Promise<BadgebaseSyncSummary> {
  const supabase = createAdminClient();

  const [activeCards, upcomingCards] = await Promise.all([
    fetchBadgebaseListing("/active"),
    fetchBadgebaseListing("/upcoming/"),
  ]);
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
    .select(
      "id,set_id,version,image_url_1x,image_url_2x,start_date,end_date,release_date,is_paid,how_to_earn,description,status",
    )
    .then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        set_id: string;
        version: string;
        image_url_1x: string | null;
        image_url_2x: string | null;
        start_date: string | null;
        end_date: string | null;
        release_date: string | null;
        is_paid: boolean;
        how_to_earn: string | null;
        description: string | null;
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

  const now = new Date();
  let enriched = 0;
  let insertedUpcoming = 0;
  let errors = 0;

  for (const { item: card, result: detail } of detailed) {
    if (!detail) {
      errors += 1;
      continue;
    }
    await applyCard(card, detail);
  }

  async function applyCard(card: BadgebaseCard, detail: Awaited<ReturnType<typeof fetchBadgebaseDetail>>) {
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

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (startDate && startDate !== existing.start_date)
        patch.start_date = startDate;
      if (endDate && endDate !== existing.end_date) patch.end_date = endDate;
      if (releaseDate && releaseDate !== existing.release_date)
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
      const status = badgeStatus(
        { start_date: startDate ?? existing.start_date, end_date: endDate ?? existing.end_date },
        now,
      );
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
      return;
    }

    // Unknown to the catalog: a badgebase announcement — usually an upcoming
    // drop before Twitch exposes it globally.
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
        status: badgeStatus({ start_date: startDate, end_date: endDate }, now),
        source: "badgebase",
        first_seen_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      },
      { onConflict: "set_id,version", ignoreDuplicates: true },
    );
    if (error) throw error;
    insertedUpcoming += 1;
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Badgebase listing sync completed",
      body: `${activeCards.length} active + ${upcomingCards.length} upcoming cards processed, ${enriched} badges enriched with drop windows and how-to-earn steps, ${insertedUpcoming} new badges inserted, ${errors} detail fetch errors.`,
      payload: {
        activeCards: activeCards.length,
        upcomingCards: upcomingCards.length,
        enriched,
        insertedUpcoming,
        errors,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  return {
    activeCards: activeCards.length,
    upcomingCards: upcomingCards.length,
    enriched,
    insertedUpcoming,
    errors,
  };
}
