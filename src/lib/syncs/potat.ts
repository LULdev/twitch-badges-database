import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchAllDistribution,
  fetchAllOwners,
} from "@/lib/twitch/potat";
import { isTicketBadge, resolveStatus } from "@/lib/twitch/types";
import { computeRarity } from "@/lib/rarity";
import { logChange } from "@/lib/changelog";

export interface PotatSyncSummary {
  distribution: number;
  owners: number;
  matched: number;
  statsInserted: number;
  rarityUpdated: number;
  statusSweeps: number;
}

const BADGE_UUID = /badges\/v1\/([0-9a-f-]{36})/i;

function extractUuid(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = BADGE_UUID.exec(url);
  return match ? match[1] : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Refresh owner/active counts from potat.app, append time-series points,
 * recompute the rarity index and sweep status transitions (expiry/countdown).
 */
export async function runPotatSync(): Promise<PotatSyncSummary> {
  const supabase = createAdminClient();

  // The owners feed can fail without failing the whole sync. That must NOT be
  // mistaken for "nobody owns anything": writing null over every owner_count
  // destroys the catalog's statistics and feeds the rarity index.
  const [distributionResult, ownersResult] = await Promise.all([
    fetchAllDistribution()
      .then((rows) => ({ ok: true as const, rows, error: null as unknown }))
      .catch((error: unknown) => ({ ok: false as const, rows: [], error })),
    fetchAllOwners()
      .then((rows) => ({ ok: true as const, rows }))
      .catch(() => ({ ok: false as const, rows: [] })),
  ]);
  // A feed that RESOLVES with an empty list is as uninformative as one that
  // throws: `ownersByBadge` would be empty and every lookup below would fall
  // through to null, wiping all owner counts. Treating it as a failure keeps the
  // stored numbers and reports ownersFeedOk=false.
  const ownersOk = ownersResult.ok && ownersResult.rows.length > 0;

  // Unlike the owners feed, the distribution feed drives every derived value
  // this sync writes, so a failed or truncated one must not reach the writes at
  // all — and must not look like a healthy run. It fails here, before anything
  // is touched, with the reason the provider gave (including the pagination cap
  // in fetchAllDistribution).
  if (!distributionResult.ok) {
    throw new Error(
      `potat distribution feed unavailable: ${
        distributionResult.error instanceof Error
          ? distributionResult.error.message
          : "unknown error"
      }`,
    );
  }
  const distribution = distributionResult.rows;

  const ownersByBadge = new Map<string, number>();
  for (const row of ownersResult.rows) {
    ownersByBadge.set(`${row.badge}:${row.version}`, row.total_owners);
  }

  // Load current badges (full rows — updates are merged and bulk-upserted,
  // because per-id PATCHes would exceed serverless function time limits).
  const badges = await supabase
    .from("badges")
    .select("*")
    .neq("status", "removed")
    .then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown> & {
        id: string;
        set_id: string;
        version: string;
        image_url_1x: string | null;
        status: string;
        start_date: string | null;
        end_date: string | null;
        first_seen_at: string;
        owner_count: number | null;
        active_count: number | null;
        percentage: number | null;
        last_polled_at: string | null;
      }>;
    });

  const byKey = new Map<string, (typeof badges)[number]>();
  const byUuid = new Map<string, (typeof badges)[number]>();
  for (const row of badges) {
    byKey.set(`${row.set_id}:${row.version}`, row);
    const uuid = extractUuid(row.image_url_1x);
    if (uuid) byUuid.set(uuid, row);
  }

  // 24h active-user growth (rarity momentum input) from the time series.
  const { data: momentumRows } = await supabase
    .from("badge_momentum")
    .select("badge_id, growth_24h");
  const growthByBadge = new Map<string, number | null>(
    ((momentumRows ?? []) as Array<{ badge_id: string; growth_24h: number | null }>).map(
      (row) => [row.badge_id, row.growth_24h],
    ),
  );

  const now = new Date();
  let matched = 0;
  let statsInserted = 0;
  let rarityUpdated = 0;
  let statusSweeps = 0;

  const upsertRows: Array<Record<string, unknown>> = [];
  const statRows: Array<{
    badge_id: string;
    owner_count: number | null;
    active_count: number | null;
    percentage: number | null;
  }> = [];

  for (const row of distribution) {
    const badge =
      byKey.get(`${row.badge}:${row.version}`) ??
      (row.url ? byUuid.get(extractUuid(row.url) ?? "") : undefined);
    if (!badge) continue;
    matched += 1;

    const totalOwners = ownersOk
      ? (ownersByBadge.get(`${row.badge}:${row.version}`) ?? null)
      : (badge.owner_count as number | null);
    const activeUsers = row.user_count ?? null;
    const percentage = row.percentage ?? null;

    const rarity = computeRarity(
      {
        totalOwners,
        activeUsers,
        status: badge.status as "active" | "upcoming" | "expired" | "removed",
        startDate: badge.start_date,
        endDate: badge.end_date,
        firstSeenAt: badge.first_seen_at,
        growth24h: growthByBadge.get(badge.id) ?? null,
        requiresTicket: isTicketBadge(
          badge.set_id as string,
          badge.how_to_earn as string | null,
          badge.description as string | null,
        ),
      },
      now,
    );

    const nextStatus =
      badge.status === "removed"
        ? badge.status
        : resolveStatus(
            {
              start_date: badge.start_date,
              end_date: badge.end_date,
              is_confirmed_active:
                (badge.is_confirmed_active as boolean | null) ?? false,
            },
            now,
          );

    const valuesChanged =
      totalOwners !== badge.owner_count ||
      activeUsers !== badge.active_count;
    const lastOld =
      !badge.last_polled_at ||
      now.getTime() - new Date(badge.last_polled_at).getTime() > 3_600_000;

    const tierChanged = rarity.tier !== badge.rarity_tier;
    if (valuesChanged || lastOld || nextStatus !== badge.status || tierChanged) {
      upsertRows.push({
        ...badge,
        owner_count: totalOwners,
        active_count: activeUsers,
        percentage,
        last_polled_at: now.toISOString(),
        rarity_score: rarity.score,
        rarity_tier: rarity.tier,
        ...(nextStatus !== badge.status ? { status: nextStatus } : {}),
      });
      rarityUpdated += 1;
      if (nextStatus !== badge.status) statusSweeps += 1;
    }

    // Append a time-series point when values changed or the last point is old.
    if (valuesChanged || lastOld) {
      statRows.push({
        badge_id: badge.id,
        owner_count: totalOwners,
        active_count: activeUsers,
        percentage,
      });
    }
  }

  // Two distribution rows can resolve to the same catalog row: the byUuid
  // fallback matches any version sharing one image UUID, and the feed can
  // repeat a badge. Postgres rejects a batch that would update one conflict
  // key twice (SQLSTATE 21000) and the whole sync dies after `distribution`
  // already succeeded, so collapse to one row per key (last write wins).
  const pendingByKey = new Map<string, Record<string, unknown>>();
  for (const row of upsertRows) {
    pendingByKey.set(`${String(row.set_id)}:${String(row.version)}`, row);
  }

  for (const batch of chunk([...pendingByKey.values()], 200)) {
    const { error } = await supabase
      .from("badges")
      .upsert(batch, { onConflict: "set_id,version" });
    if (error) throw error;
  }

  for (const batch of chunk(statRows, 200)) {
    const { error } = await supabase.from("badge_stats").insert(batch);
    if (error) throw error;
    statsInserted += batch.length;
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Stats sync completed",
      body: `${distribution.length} potat rows fetched, ${matched} badges matched, ${statsInserted} stats points appended, ${statusSweeps} status sweeps, rarity recomputed.${ownersOk ? "" : " Owner feed unavailable — existing owner counts were kept."}`,
      payload: {
        distribution: distribution.length,
        owners: ownersResult.rows.length,
        ownersFeedOk: ownersOk,
        matched,
        statsInserted,
        statusSweeps,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  return {
    distribution: distribution.length,
    owners: ownersResult.rows.length,
    matched,
    statsInserted,
    rarityUpdated,
    statusSweeps,
  };
}
