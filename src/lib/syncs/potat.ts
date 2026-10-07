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
  /** False when the owners feed failed or came back empty and stored counts were kept. */
  ownersFeedOk: boolean;
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
  // Paged: a single select silently stops at PostgREST's 1000-row cap, after
  // which the rows past it never get their owner counts or rarity refreshed.
  type BadgeRow = Record<string, unknown> & {
    id: string;
    set_id: string;
    version: string;
    // slug + title are read only to satisfy the upsert's NOT NULL check (see
    // the upsert comment) and are written back unchanged.
    slug: string;
    title: string;
    image_url_1x: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
    first_seen_at: string;
    owner_count: number | null;
    active_count: number | null;
    percentage: number | null;
    last_polled_at: string | null;
  };
  const badges: BadgeRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("badges")
      .select("*")
      .neq("status", "removed")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as BadgeRow[];
    badges.push(...page);
    if (page.length < 1000) break;
  }

  const byKey = new Map<string, (typeof badges)[number]>();
  const byUuid = new Map<string, (typeof badges)[number]>();
  for (const row of badges) {
    byKey.set(`${row.set_id}:${row.version}`, row);
    const uuid = extractUuid(row.image_url_1x);
    if (uuid) byUuid.set(uuid, row);
  }

  // 24h active-user growth (rarity momentum input) from the time series.
  const { data: momentumRows, error: momentumError } = await supabase
    .from("badge_momentum")
    .select("badge_id, growth_24h");
  // Read errors in this file throw (see the catalog paging read above): a failed
  // momentum read silently yielded an empty map, every badge got growth24h null,
  // momentumOf() returned the neutral 0.5, and rarity_score/rarity_tier were
  // written wrong for the entire catalog while the run still reported ok. The view
  // ships in migration 0002, so an error here is a real failure.
  if (momentumError) throw momentumError;
  const growthByBadge = new Map<string, number | null>(
    // growth_24h is int8 in Postgres, so PostgREST returns it as a string;
    // rarity.ts's momentumOf() guards with Number.isFinite, which rejects
    // "42", so without coercion the momentum term stays neutral 0.5 forever.
    // null stays null — Number(null) would fabricate a real 0 growth.
    ((momentumRows ?? []) as Array<{ badge_id: string; growth_24h: number | null }>).map(
      (row) => [row.badge_id, row.growth_24h == null ? null : Number(row.growth_24h)],
    ),
  );

  const now = new Date();
  let matched = 0;
  let statsInserted = 0;
  let rarityUpdated = 0;
  let statusSweeps = 0;

  const upsertRows: Array<Record<string, unknown>> = [];
  // Rows whose rarity could NOT be recomputed (owners feed failed, or no
  // count for this badge): the same payload minus rarity_score/rarity_tier,
  // in their own array — see the payload-uniformity check below.
  const countsOnlyRows: Array<Record<string, unknown>> = [];
  // `status` now rides on every payload row (see the upsert comment), so
  // "does this row carry a status key" no longer distinguishes a sweep from an
  // unchanged badge. The ids that actually moved are tracked here instead, and
  // the collapsed set below is what the summary reports.
  const statusSweepIds = new Set<string>();
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

    const feedOwners = ownersByBadge.get(`${row.badge}:${row.version}`);
    // totalOwners must be a JS number (or null). The owners feed hands back
    // JSON numbers, but the fallback (badge.owner_count) is a PostgREST
    // bigint STRING: a raw string poisons both the !== comparisons below and
    // computeRarity (its Number.isFinite checks reject "1234"). null must
    // stay null — Number(null) would fabricate "0 owners".
    const totalOwners =
      ownersOk && feedOwners !== undefined && feedOwners !== null
        ? Number(feedOwners)
        : (badge.owner_count == null ? null : Number(badge.owner_count));
    const activeUsers = row.user_count ?? null;
    const percentage = row.percentage ?? null;

    // Recompute rarity only from a real numeric count. When the owners feed
    // failed, or this badge has neither a feed value nor a stored count,
    // computeRarity would run on fallback/null input and its result would be
    // upserted over the whole catalog — the file's own comment above says
    // stored owner data must be KEPT in that case, and rarity must be too.
    const rarity =
      ownersOk && totalOwners !== null
        ? computeRarity(
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
          )
        : null;

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

    // PostgREST serializes bigint columns as strings, so badge.owner_count /
    // badge.active_count arrive as "1234" while totalOwners/activeUsers are
    // JS numbers — a direct !== comparison is then ALWAYS true, which rewrote
    // every matched row and appended a stats point on every hourly run and
    // left the lastOld throttle dead. Coerce the DB side (null stays null)
    // before comparing.
    const dbOwners = badge.owner_count == null ? null : Number(badge.owner_count);
    const dbActive = badge.active_count == null ? null : Number(badge.active_count);
    const valuesChanged =
      totalOwners !== dbOwners ||
      activeUsers !== dbActive;
    const lastOld =
      !badge.last_polled_at ||
      now.getTime() - new Date(badge.last_polled_at).getTime() > 3_600_000;

    const tierChanged = rarity !== null && rarity.tier !== badge.rarity_tier;
    if (valuesChanged || lastOld || nextStatus !== badge.status || tierChanged) {
      // ONLY the columns this sync owns, plus the four that carry no default.
      //
      // The narrowed payload is not optional. Postgres checks NOT NULL on the
      // PROPOSED tuple before it resolves ON CONFLICT, so an upsert that omits
      // a NOT NULL column without a default raises 23502 even when the row
      // exists and the conflict would have taken the DO UPDATE branch. Narrowing
      // the payload to exactly potat's columns therefore broke EVERY write:
      // set_id/version/slug/title have no default, so the proposed tuple was
      // always null there and the whole sync died at the first chunk. It ran
      // this way for 12 consecutive heartbeats before being caught.
      //
      // `status` is written on EVERY row rather than only when it changes, for
      // a different reason: PostgREST builds one INSERT whose column list is the
      // union of the keys across the batch and fills the gaps with NULL, then
      // sets every listed column in DO UPDATE. A batch where only some rows
      // carried `status` would therefore null it for the others and trip the
      // same constraint. One shape for every row is the only shape PostgREST
      // handles correctly.
      //
      // The columns deliberately still EXCLUDED are the volatile ones the
      // narrowing was for: start_date/end_date/how_to_earn/release_date/
      // is_confirmed_active, which global and badgebase own. At 06:00 UTC the
      // potat workflow fires in the same minute as the global cron, so a potat
      // write landing after theirs would undo the day's confirmation. The
      // identity columns added above are stable catalog identity that potat
      // merely echoes back unchanged, not the volatile fields.
      const payload: Record<string, unknown> = {
        id: badge.id,
        set_id: badge.set_id,
        version: badge.version,
        slug: badge.slug,
        title: badge.title,
        owner_count: totalOwners,
        active_count: activeUsers,
        percentage,
        last_polled_at: now.toISOString(),
        status: nextStatus,
      };
      if (rarity !== null) {
        // Real owner data: rarity is recomputed and written with the row.
        payload.rarity_score = rarity.score;
        payload.rarity_tier = rarity.tier;
        upsertRows.push(payload);
        rarityUpdated += 1;
      } else {
        // No usable owner data (feed failed or no count for this badge): write
        // counts/status only and leave rarity alone. It must be a SEPARATE
        // array, not a rarity-less row inside upsertRows: (1) PostgREST builds
        // each request's column list from the union of the batch's keys and
        // fills the gaps with NULL, so one rarity-carrying row in the batch
        // would NULL rarity_score/rarity_tier for every counts-only row in it;
        // (2) DO UPDATE touches only listed columns, so a batch that never
        // lists the rarity keys leaves the stored values physically untouched.
        countsOnlyRows.push(payload);
      }
      if (nextStatus !== badge.status) {
        statusSweeps += 1;
        statusSweepIds.add(badge.id);
      }
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
  // The key is `id` — the narrowed payload carries `id` (the PK), not
  // `set_id`/`version`, and the upsert's conflict target matches it.
  const pendingByKey = new Map<string, Record<string, unknown>>();
  for (const row of upsertRows) {
    pendingByKey.set(String(row.id), row);
  }
  // The counts-only rows get the same collapse. A badge can appear in only
  // ONE of the two arrays — the rarity-usable decision depends solely on
  // ownersOk + totalOwners, which are deterministic per badge — so no id
  // ever lands in both batches.
  const pendingCountsByKey = new Map<string, Record<string, unknown>>();
  for (const row of countsOnlyRows) {
    pendingCountsByKey.set(String(row.id), row);
  }
  // Count from the COLLAPSED rows: the loop above tallies per distribution
  // entry, so a repeated badge inflated `rarityUpdated` and `statusSweeps` in
  // the changelog while the database only ever received one row.
  const finalRows = [...pendingByKey.values()];
  const finalCountsRows = [...pendingCountsByKey.values()];
  rarityUpdated = finalRows.length;
  statusSweeps =
    finalRows.filter((row) => statusSweepIds.has(String(row.id))).length +
    finalCountsRows.filter((row) => statusSweepIds.has(String(row.id))).length;

  // The same collapse must apply to the time-series points: when one catalog
  // row resolves through several distribution entries (byUuid fallback, or the
  // feed repeating a badge within a page window), the loop pushes one statRows
  // entry per match. Writing both creates two badge_stats rows with the same
  // polled_at, and badge_momentum orders by polled_at with no tiebreaker — so
  // which duplicate the rarity read lands on is index order, and the chart gets
  // a double-counted point. One point per badge per run.
  const statByKey = new Map<string, Record<string, unknown>>();
  for (const row of statRows) statByKey.set(String(row.badge_id), row);
  const finalStatRows = [...statByKey.values()];

  // PostgREST derives one column list from the union of the batch's keys, so a
  // payload whose rows disagree on shape is not "mostly fine": the missing keys
  // are sent as NULL and then written over the live row. A single unequal shape
  // therefore has to fail HERE, loudly, rather than corrupting a column for the
  // subset of rows that omitted it.
  const assertUniform = (
    rows: Array<Record<string, unknown>>,
    label: string,
  ): void => {
    const payloadShape = Object.keys(rows[0] ?? {}).sort().join(",");
    const uneven = rows.filter(
      (row) => Object.keys(row).sort().join(",") !== payloadShape,
    );
    if (uneven.length > 0) {
      throw new Error(
        `potat upsert payload is not uniform (${label}): ${uneven.length} of ${rows.length} rows have a different column set than the first (${payloadShape})`,
      );
    }
  };
  assertUniform(finalRows, "rarity");
  // The counts-only batch is a separate PostgREST request with its own column
  // set (no rarity keys) — an unequal shape inside it would corrupt the same
  // way, so it fails the same check.
  assertUniform(finalCountsRows, "counts-only");

  // Chunked commits again: a failure in a later chunk leaves earlier ones live
  // with no changelog row — the undocumented-mutation case the other syncs
  // guard against. Log what was in flight (flagged) before rethrowing.
  try {
    for (const batch of chunk(finalRows, 200)) {
      const { error } = await supabase
        .from("badges")
        .upsert(batch, { onConflict: "id" });
      if (error) throw error;
    }

    // Counts-only rows omit the rarity columns; PostgREST's DO UPDATE touches
    // only the columns a batch lists, so this second uniform batch refreshes
    // counts/status while leaving stored rarity_score/rarity_tier untouched.
    for (const batch of chunk(finalCountsRows, 200)) {
      const { error } = await supabase
        .from("badges")
        .upsert(batch, { onConflict: "id" });
      if (error) throw error;
    }

    for (const batch of chunk(finalStatRows, 200)) {
      const { error } = await supabase.from("badge_stats").insert(batch);
      if (error) throw error;
      statsInserted += batch.length;
    }
  } catch (writeError) {
    await logChange(
      {
        kind: "data_sync",
        title: "Stats sync failed mid-write",
        body: `The potat sync aborted on a database error after committing earlier chunks: ${rarityUpdated} badge updates and ${statsInserted} stats points were in flight. Error: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        payload: {
          distribution: distribution.length,
          matched,
          rarityUpdated,
          statsInserted,
          failed: true,
          ranAt: now.toISOString(),
        },
      },
      supabase,
    );
    throw writeError;
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
    // Surfaced on the summary so the cron routes can record a DEGRADED heartbeat
    // for a run that kept stored owner counts because the feed was unavailable:
    // this function deliberately resolves normally in that case, so without the
    // flag the uptime view stayed green through an owners outage.
    ownersFeedOk: ownersOk,
  };
}
