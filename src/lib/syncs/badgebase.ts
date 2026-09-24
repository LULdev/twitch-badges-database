import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBadgebaseListing,
  fetchBadgebaseDetail,
  type BadgebaseCard,
  type BadgebaseDetail,
} from "@/lib/twitch/badgebase";
import {
  guessCategory,
  isStatusSetId,
  resolveStatus,
} from "@/lib/twitch/types";
import { logChange } from "@/lib/changelog";

export interface BadgebaseSyncSummary {
  /** Set when the run deliberately did nothing (e.g. an empty /active listing). */
  skipped?: string;
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
/**
 * Authoritative drop-status sync from badgebase.de's curated listings:
 *   /active   → currently redeemable (status 'active' + is_confirmed_active)
 *   /upcoming → announced, pre-release (status 'upcoming')
 * Every badge NOT on the active list and without a live claim window is demoted to
 * 'expired' — only genuinely redeemable badges stay "active". End dates (countdown
 * expiry) and how-to-earn steps come from the detail pages.
 *
 * Confirmation is derived from the LISTING, not from the detail fetch: the detail
 * budget is a politeness cap, and a badge on /active is redeemable right now whether
 * or not its page was fetched.
 */
export async function runBadgebaseSync(): Promise<BadgebaseSyncSummary> {
  const supabase = createAdminClient();

  const [activeCards, upcomingCards] = await Promise.all([
    fetchBadgebaseListing("/active"),
    fetchBadgebaseListing("/upcoming/"),
  ]);
  const activeList = activeCards.filter((card) => !isStatusSetId(card.slug));
  const upcomingList = upcomingCards.filter((card) => !isStatusSetId(card.slug));

  // Load the catalog FIRST, paged: a single select silently stops at 1000 rows, and
  // a sweep built on a truncated view gains a blind spot past that.
  const allBadges: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("badges")
      .select("*")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    allBadges.push(...page);
    if (page.length < 1000) break;
  }

  // Keys confirmed active by the /active listing (uuid or set_id).
  const activeKeys = new Set<string>();
  for (const card of activeList) {
    if (card.imageUuid) activeKeys.add(card.imageUuid);
    activeKeys.add(card.slug);
  }
  // Count DISTINCT confirmed badges, not rows. One badge can own several rows
  // (versions sharing an image UUID), so comparing a row count against a parsed
  // CARD count is a unit mismatch: it trips the guard on healthy data and, because
  // the skip returns before pass 2 — the only place `is_confirmed_active` is ever
  // cleared — stays tripped. Keyed the same way the sweep keys a row.
  const confirmedKeys = new Set<string>();
  for (const row of allBadges) {
    if (row.is_confirmed_active !== true) continue;
    // Only rows pass 2 can actually clear belong in this denominator. It skips
    // `custom` rows (:317) and `removed` rows that are not on the active list
    // (:329-332), so their flag is never cleared — counting them let the
    // denominator inflate run after run until `activeList.length <
    // confirmedExists * 0.5` latched on healthy data, and because the skip
    // returns before pass 2 it could never recover.
    if (row.source === "custom") continue;
    if (row.status === "removed") continue;
    confirmedKeys.add(
      extractUuid(row.image_url_1x as string | null) ??
        extractUuid(row.image_url_2x as string | null) ??
        (row.set_id as string),
    );
  }
  const confirmedExists = confirmedKeys.size;

  // Incident guard. An empty listing is the obvious incident; a PARTIAL parse — the
  // hand-rolled regex matching one card of twenty — is the dangerous one, because the
  // sweep below would expire everything it can no longer see. Compare what was parsed
  // against the confirmed-active rows the catalog holds and skip rather than trust a
  // suspiciously short list.
  const suspicious =
    confirmedExists > 0 &&
    (activeList.length === 0 || activeList.length < confirmedExists * 0.5);
  if (suspicious) {
    const reason = activeList.length === 0 ? "empty-listing" : "active-listing-ratio";
    console.warn(
      `[badgebase] /active parsed ${activeList.length} cards against ${confirmedExists} confirmed-active badges — skipping this run (${reason})`,
    );
    // Recorded, not just returned: a silent skip looks identical to a healthy run on
    // the uptime view, which is exactly the failure this guard exists to make visible.
    await logChange(
      {
        kind: "data_sync",
        title: "Drop-window sync skipped: the /active listing looks truncated",
        body: `Parsed ${activeList.length} active cards against ${confirmedExists} confirmed-active badges in the catalog. Nothing was written — sweeping on a truncated listing would have demoted every dateless badge.`,
        payload: { skipped: reason, parsed: activeList.length, confirmedExists },
      },
      supabase,
    );
    return {
      activeCards: activeList.length,
      upcomingCards: upcomingList.length,
      enriched: 0,
      inserted: 0,
      demotedToExpired: 0,
      errors: 0,
      skipped: reason,
    };
  }

  // Detail budget, with a floor reserved for /upcoming so a long /active list
  // cannot starve it. A card past the cap is still confirmed from the listing.
  //
  // Sized against the serverless ceiling: /api/cron/global runs this engine AND
  // the catalog diff under one 60 s `maxDuration`, so the detail phase must stay
  // a small fraction of it. Worst case here is ceil(24/6) × the per-fetch timeout
  // = 4 × 8 s = 32 s (was 12 × 15 s = 180 s, which could not fit). The listing is
  // the authoritative input and every card on it is confirmed whether or not its
  // detail page was fetched, so a smaller cap costs only end-date precision on the
  // cards past it.
  const DETAIL_CAP = 24;
  const UPCOMING_FLOOR = 10;
  const upcomingBudget = Math.min(upcomingList.length, UPCOMING_FLOOR);
  const activeBudget = Math.max(0, DETAIL_CAP - upcomingBudget);
  const capped: BadgebaseCard[] = [
    ...activeList.slice(0, activeBudget),
    ...upcomingList.slice(0, upcomingBudget),
  ];
  // Concurrency 6: 1.5× the original 4. badgebase's HTML fetch has no Retry-After
  // handling, so this stays deliberately modest.
  const detailed = await mapLimit(capped, 6, (card) =>
    fetchBadgebaseDetail(`/b/${card.badgeId}-${card.slug}/`),
  );
  const detailFor = new Map<string, BadgebaseDetail | null>();
  let errors = 0;
  for (const { item: card, result: detail } of detailed) {
    if (!detail) errors += 1;
    detailFor.set(`${card.badgeId}-${card.slug}`, detail);
  }

  const byUuid = new Map<string, Record<string, unknown>>();
  const bySetId = new Map<string, Record<string, unknown>>();
  for (const row of allBadges) {
    const uuid =
      extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    if (uuid) byUuid.set(uuid, row);
    if (!bySetId.has(row.set_id as string)) bySetId.set(row.set_id as string, row);
  }

  const now = new Date();
  let enriched = 0;
  let inserted = 0;
  let demotedToExpired = 0;

  // Every write is collected into one of two keyed maps and flushed in bulk:
  // PostgREST rejects a batch that touches the same (set_id, version) twice, and a
  // per-row PATCH loop risked the 60 s route limit.
  const inserts = new Map<string, Record<string, unknown>>();
  const updates = new Map<string, Record<string, unknown>>();

  // Columns owned by the owner-statistics sync or by the database. Writing them back
  // from this run's snapshot would revert a potat write that landed in between — the
  // same rule global.ts applies.
  const NOT_BADGEBASE_OWNED = new Set([
    "id", "created_at", "updated_at",
    "owner_count", "active_count", "percentage", "last_polled_at",
    "rarity_score", "rarity_tier",
  ]);
  const strip = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !NOT_BADGEBASE_OWNED.has(key)),
    );

  // Pass 1 — every listed card. `/upcoming` first and `/active` last, so that if two
  // cards resolve to the same catalog row the /active confirmation wins.
  for (const card of [...upcomingList, ...activeList]) {
    const detail = detailFor.get(`${card.badgeId}-${card.slug}`) ?? null;
    const existing =
      (card.imageUuid ? byUuid.get(card.imageUuid) : undefined) ??
      bySetId.get(card.slug);
    // Admin-authored rows are the dashboard's, not the provider's.
    if (existing?.source === "custom") continue;

    const confirmedActive = card.status === "active";
    const cardStart = card.startTs ? new Date(card.startTs * 1000).toISOString() : null;

    if (existing) {
      const patch: Record<string, unknown> = {};
      let startDate = existing.start_date as string | null;
      let endDate = existing.end_date as string | null;
      if (detail) {
        startDate = detail.startDate ?? cardStart;
        endDate = detail.endDate;
        if (startDate !== existing.start_date) patch.start_date = startDate;
        if (endDate !== existing.end_date) patch.end_date = endDate;
        if (startDate !== existing.release_date) patch.release_date = startDate;
        const isPaid = card.tags.includes("paid")
          ? true
          : card.tags.includes("free")
            ? false
            : null;
        if (isPaid !== null && isPaid !== existing.is_paid) patch.is_paid = isPaid;
        if (detail.howToEarn && detail.howToEarn !== existing.how_to_earn)
          patch.how_to_earn = detail.howToEarn;
      }
      if ((existing.is_confirmed_active as boolean | null) !== confirmedActive) {
        patch.is_confirmed_active = confirmedActive;
      }
      // resolveStatus is the single source of truth for status (a future start still
      // counts as "upcoming" even when confirmed). Forcing "active" here made
      // badgebase and global/potat rewrite each other on every run.
      const status = resolveStatus(
        {
          start_date: startDate,
          end_date: endDate,
          is_confirmed_active: confirmedActive,
        },
        now,
      );
      if (existing.status === "removed") {
        // A card still listed here was never really gone: the global key-based sweep
        // removed it because its set_id is a badgebase slug.
        patch.status = status;
        patch.removed_at = null;
      } else if (status !== existing.status) {
        patch.status = status;
      }
      if (Object.keys(patch).length > 0) {
        updates.set(
          `${existing.set_id as string}:${existing.version as string}`,
          strip({ ...existing, ...patch }),
        );
        enriched += 1;
      }
      continue;
    }

    // Unknown to the catalog: only insertable when a detail page supplied the
    // description and dates. A card beyond the cap that is unknown cannot be invented,
    // but it *is* already confirmed as active by the listing check.
    if (!detail) continue;
    inserts.set(`${card.slug}:1`, {
      set_id: card.slug,
      version: "1",
      slug: `${card.slug}-v1`,
      title: card.title ?? card.slug,
      description: detail.description,
      image_url_1x: card.imageUrl,
      image_url_2x: card.imageUrl,
      image_url_4x: card.imageUrl,
      category: guessCategory(card.slug),
      is_paid: card.tags.includes("paid"),
      how_to_earn: detail.howToEarn,
      start_date: detail.startDate ?? cardStart,
      end_date: detail.endDate,
      release_date: detail.startDate ?? cardStart,
      status: resolveStatus(
        {
          start_date: detail.startDate ?? cardStart,
          end_date: detail.endDate,
          is_confirmed_active: confirmedActive,
        },
        now,
      ),
      is_confirmed_active: confirmedActive,
      source: "badgebase",
      first_seen_at: now.toISOString(),
      last_seen_at: now.toISOString(),
    });
  }

  // Pass 2 — sweep every catalog row not confirmed by the listing and without a live
  // window. Hand-made rows are out of the provider's reach.
  for (const row of allBadges) {
    if (row.source === "custom") continue;
    const key = `${row.set_id as string}:${row.version as string}`;
    const uuid1 = extractUuid(row.image_url_1x as string | null);
    const uuid2 = extractUuid(row.image_url_2x as string | null);
    // Both sizes are consulted: pass 1 may have matched the card through its 2x
    // UUID while the 1x URL carries a different one, in which case trusting the
    // 1x alone would let the sweep demote a row pass 1 just confirmed.
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (uuid1 ? activeKeys.has(uuid1) : false) ||
      (uuid2 ? activeKeys.has(uuid2) : false);

    if (row.status === "removed") {
      // Only resurrect what the /active listing vouches for; a genuinely gone badge
      // stays removed. This also recovers rows outside the detail cap.
      if (!onActiveList) continue;
      if (!updates.has(key)) {
        // resolveStatus, not a hardcoded "active": a confirmed row with a future
        // start_date is "upcoming", and hardcoding it made potat flip the row
        // back on its next sweep.
        updates.set(
          key,
          strip({
            ...row,
            is_confirmed_active: true,
            status: resolveStatus(
              {
                start_date: row.start_date as string | null,
                end_date: row.end_date as string | null,
                is_confirmed_active: true,
              },
              now,
            ),
            removed_at: null,
          }),
        );
      }
      continue;
    }
    if (onActiveList) continue;

    // Merge onto whatever pass 1 already decided for this row, so the status is
    // computed from the values the row will actually carry.
    const base = updates.get(key) ?? row;
    const nextStatus = resolveStatus(
      {
        start_date: base.start_date as string | null,
        end_date: base.end_date as string | null,
        is_confirmed_active: false,
      },
      now,
    );
    if (base.status !== nextStatus || (base.is_confirmed_active as boolean)) {
      updates.set(key, strip({ ...base, is_confirmed_active: false, status: nextStatus }));
      if (nextStatus === "expired" && row.status !== "expired") demotedToExpired += 1;
    }
  }

  // Inserts first, counted from what the database actually inserted: a conflict
  // discarded by ignoreDuplicates must not inflate the number (the old code
  // incremented once per loop turn regardless).
  // The writes are chunked, so a failure in chunk 2 leaves chunk 1 committed and
  // live. Every committed chunk is a sync mutation, so a partial run MUST still
  // leave a changelog row (AGENTS: every sync mutation writes one). Document the
  // committed prefix and rethrow; the success path below logs its own row.
  try {
    const insertRows = [...inserts.values()];
    for (let i = 0; i < insertRows.length; i += 200) {
      const { data, error } = await supabase
        .from("badges")
        .upsert(insertRows.slice(i, i + 200), {
          onConflict: "set_id,version",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw error;
      inserted += (data ?? []).length;
    }

    const updateRows = [...updates.values()];
    for (let i = 0; i < updateRows.length; i += 200) {
      const { error } = await supabase
        .from("badges")
        .upsert(updateRows.slice(i, i + 200), { onConflict: "set_id,version" });
      if (error) throw error;
    }
  } catch (error) {
    await logChange(
      {
        kind: "data_sync",
        title: "Drop-window listing sync failed mid-sweep",
        body: `The catalog sweep aborted on a write error. Committed chunks are already live: ${inserted} badges inserted before the failure, ${demotedToExpired} badges demoted to expired. Error: ${error instanceof Error ? error.message : String(error)}`,
        payload: {
          activeCards: activeList.length,
          upcomingCards: upcomingList.length,
          enriched,
          inserted,
          demotedToExpired,
          errors,
          failed: true,
        },
      },
      supabase,
    );
    throw error;
  }

  // The upserts above already landed, so this run MUST leave a changelog row even
  // when it ends in failure (AGENTS: every sync mutation writes one). The row is
  // written first and its title states the failure; the throw stays after it so
  // the heartbeat records an error and the run is not reported as completed.
  const allDetailsFailed = capped.length > 0 && errors === capped.length;

  await logChange(
    {
      kind: "data_sync",
      title: allDetailsFailed
        ? "Drop-window listing sync wrote status changes but every detail fetch failed"
        : "Drop-window listing sync completed",
      body: `${activeList.length} active + ${upcomingList.length} upcoming cards processed, ${enriched} badges enriched, ${inserted} new badges inserted, ${demotedToExpired} badges demoted to expired, ${errors} detail fetch errors.${allDetailsFailed ? " Every detail fetch failed, so no badge received a real claim window — the run is treated as failed." : ""}`,
      payload: {
        activeCards: activeList.length,
        upcomingCards: upcomingList.length,
        enriched,
        inserted,
        demotedToExpired,
        errors,
        allDetailsFailed,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  if (allDetailsFailed) {
    throw new Error(`badgebase: all ${errors} detail fetches failed — treating the run as failed`);
  }

  return {
    activeCards: activeList.length,
    upcomingCards: upcomingList.length,
    enriched,
    inserted,
    demotedToExpired,
    errors,
  };
}
