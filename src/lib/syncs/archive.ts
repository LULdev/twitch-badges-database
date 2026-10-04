import { createAdminClient } from "@/lib/supabase/admin";
import { logChange } from "@/lib/changelog";
import {
  captureDate,
  captureUrl,
  fetchCaptures,
  fetchSnapshot,
  spreadByYear,
  type ArchiveCapture,
} from "@/lib/twitch/wayback";
import {
  isLikelyArchiveErrorPage,
  parseArchivedOwnerCount,
} from "@/lib/twitch/archive-parse";

export interface ArchiveBackfillOptions {
  /**
   * Max badges considered. The default is deliberately small: a first run has
   * to fit a 60 s serverless budget, and the real cost driver is the number of
   * snapshot requests (see SNAPSHOT_BUDGET), not the number of badges.
   */
  limit?: number;
  /** Captures kept per calendar year, per source. */
  maxPerYear?: number;
  /** Simultaneous requests to the archive. See CONCURRENCY. */
  concurrency?: number;
  /**
   * Wall-clock budget for the whole run. Work still outstanding when it expires
   * is abandoned and counted, never silently dropped, and the summary is written
   * as normal — a run that returns is worth far more than a run that is killed
   * at the platform's ceiling with no changelog row, no heartbeat and no record
   * of what it had done. Defaults below the caller: the cron route passes the
   * remainder of its own `maxDuration`.
   */
  deadlineMs?: number;
  /**
   * Compute the whole thing and write nothing, reporting what would have been
   * written. This is how the feature is validated against production.
   */
  dryRun?: boolean;
  /** Restrict the run to specific set_ids — how a dry run targets known-good badges. */
  onlySetIds?: string[];
}

export interface ArchiveBackfillSummary {
  badgesConsidered: number;
  capturesFound: number;
  /** Snapshots actually retrieved and read. */
  capturesFetched: number;
  /**
   * Snapshots that yielded no usable markup: a failed request, or one of
   * Wayback's own "not archived" / redirect-stub / rate-limit pages. Counted
   * apart from skippedNoValue so a run against a degraded archive cannot read
   * like a run that simply found nothing worth storing.
   */
  capturesUnreadable: number;
  valuesRecovered: number;
  inserted: number;
  skippedNotEarlierThanMeasured: number;
  skippedDuplicate: number;
  skippedNoValue: number;
  /** Capture timestamps after now() — a CDX or clock artifact. */
  skippedFuture: number;
  /** Candidates dropped by the per-run request budget before any fetch. */
  cappedByRequestBudget: number;
  /**
   * Queue items abandoned because the run's wall-clock budget expired — badge
   * lookups and snapshot fetches alike, counted together. They are two kinds of
   * work and a run that abandoned only one of them cannot be told apart here;
   * both mean the same thing to the operator, which is "re-run to continue".
   */
  skippedDeadline: number;
  /** Sources that threw for every lookup. */
  sourcesUnavailable: string[];
  /**
   * Sources that answered every lookup and produced nothing. A wrong URL shape
   * looks exactly like this, so it must not read as a healthy empty run.
   */
  sourcesWithNoCaptures: string[];
  dryRun: boolean;
  /**
   * Points this run was ready to write. On a dry run `inserted` is 0 by
   * definition and this is the number that would have landed instead.
   */
  wouldInsert: number;
  /** True when the run hit its wall-clock budget before finishing its queue. */
  deadlineReached: boolean;
}

const BADGEBASE_BASE = "https://badgebase.de/b/*";
const POTAT_BADGE_BASE = "https://potat.app/badges/";

/** Captures scanned per lookup. The CDX index is the most hammered endpoint here. */
const CAPTURE_SCAN_LIMIT = 200;

/**
 * Hard ceiling on snapshot requests per run. Wayback is volunteer
 * infrastructure and the index throttles aggressively, so the request count —
 * not the badge count — is the real budget. The oldest captures are kept first:
 * the recent tail is what this site already measures itself.
 */
const SNAPSHOT_BUDGET = 60;

/**
 * Concurrency 2. badgebase's own sync uses 6 against a site that serves an API
 * for this purpose; web.archive.org is a volunteer-run archive with no SLA that
 * throttles by dropping requests, so the number is set by politeness rather
 * than throughput.
 */
const CONCURRENCY = 2;

/**
 * Default wall-clock budget. Sized for the cron route's 60 s `maxDuration` with
 * room left for the changelog write and the response: a 15 s fetch ceiling, two
 * in flight and a queue of SNAPSHOT_BUDGET means the request cap alone can
 * overrun 60 s by an order of magnitude, and a run that is killed at the
 * platform ceiling produces no summary, no heartbeat and no changelog row.
 */
const DEADLINE_MS = 45_000;

const WRITE_CHUNK = 200;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

interface ArchiveBadgeRow {
  id: string;
  set_id: string;
  slug: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does this archived URL belong to THIS badge?
 *
 * A CDX prefix query happily returns `/b/1234-some-other-badge/`, and a capture
 * of the wrong badge's page yields a number that would sit in the catalog
 * permanently and feed the rarity index forever. The test is deliberately
 * narrow: the identifier has to appear as a whole `-`-delimited token inside a
 * path segment, so `1234-bits-2023` and `bits-2023-v1` both match the badge
 * `bits-2023` while `no-sub` does not match the badge `sub`.
 */
function captureBelongsToBadge(original: string, identifiers: string[]): boolean {
  let pathname: string;
  try {
    pathname = new URL(original).pathname;
  } catch {
    return false;
  }
  return pathname
    .split("/")
    .filter(Boolean)
    .some((segment) =>
      identifiers.some((id) =>
        new RegExp(`(^|-)${escapeRegExp(id)}(-|$)`).test(segment),
      ),
    );
}

function isUniqueViolation(error: { code?: unknown } | null): boolean {
  return !!error && error.code === UNIQUE_VIOLATION;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A usable number recovered from one capture. */
interface RecoveredPoint {
  badgeId: string;
  polledAt: string;
  ownerCount: number;
  sourceUrl: string;
}

interface CaptureGroup {
  name: string;
  captures: ArchiveCapture[];
  down: boolean;
}

/**
 * One-time recovery pass: pull dated public snapshots of badge owner pages out
 * of the Wayback Machine and append them to `badge_stats` as
 * `source = 'archive'`, extending owner curves years earlier than this site has
 * been collecting for itself.
 *
 * The central invariant, enforced three times below: an archived point may only
 * ever land STRICTLY BEFORE the first point this site measured itself. The
 * failure it prevents is not cosmetic. `badge_momentum` reads `badge_stats` with
 * a `polled_at <= now() - 20 hours` predicate and no source filter, so a 2023
 * archive row would silently turn "24h growth" into "growth since 2023" — a
 * large negative number on every old badge, fed straight into computeRarity()
 * and written back across the whole catalog.
 *
 * Nothing here is scheduled: this is a recovery pass, not a recurring job.
 */
export async function runArchiveBackfill(
  options: ArchiveBackfillOptions = {},
): Promise<ArchiveBackfillSummary> {
  const supabase = createAdminClient();

  const dryRun = options.dryRun === true;
  const badgeLimit = Math.max(0, options.limit ?? 25);
  const maxPerYear = Math.max(1, options.maxPerYear ?? 1);
  const concurrency = Math.max(1, options.concurrency ?? CONCURRENCY);
  const deadlineAt = Date.now() + Math.max(1_000, options.deadlineMs ?? DEADLINE_MS);
  const outOfTime = () => Date.now() >= deadlineAt;

  const counters = {
    badgesConsidered: 0,
    capturesFound: 0,
    capturesFetched: 0,
    capturesUnreadable: 0,
    valuesRecovered: 0,
    inserted: 0,
    skippedNotEarlierThanMeasured: 0,
    skippedDuplicate: 0,
    skippedNoValue: 0,
    skippedFuture: 0,
    cappedByRequestBudget: 0,
    skippedDeadline: 0,
    sourcesUnavailable: new Set<string>(),
    sourcesWithNoCaptures: new Set<string>(),
    dryRun,
    wouldInsert: 0,
    deadlineReached: false,
  };
  const toSummary = (): ArchiveBackfillSummary => ({
    ...counters,
    sourcesUnavailable: [...counters.sourcesUnavailable],
    sourcesWithNoCaptures: [...counters.sourcesWithNoCaptures],
  });

  // The catalog, paged: a single select silently stops at PostgREST's 1000-row
  // cap, after which the badges past it would never get their history back.
  //
  // Deliberately NOT filtered to `status <> 'removed'` the way the other syncs
  // are: the badges worth backfilling are the long-dead ones, whose curves
  // exist only in the archive. This pass reads no live status and writes none.
  const allBadges: ArchiveBadgeRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from("badges").select("id, set_id, slug").order("id");
    if (options.onlySetIds && options.onlySetIds.length > 0) {
      query = query.in("set_id", options.onlySetIds);
    }
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as ArchiveBadgeRow[];
    allBadges.push(...page);
    if (page.length < 1000) break;
  }
  // Ordering by `id` (a uuid) samples roughly at random, which is the right
  // unbiased default but a poor validator: most badges were never popular
  // enough to be archived. `onlySetIds` is how a dry run is pointed at
  // known-good badges.
  const badges = allBadges.slice(0, badgeLimit);
  counters.badgesConsidered = badges.length;

  if (badges.length === 0) return toSummary();

  // THE FLOOR. The earliest measured point this site has EVER written, loaded
  // as a single row. A per-badge MIN() over months of points would be tens of
  // thousands of rows per badge; the measured series was started in one pass, so
  // the site-wide floor is earlier than or equal to every badge's own first
  // point. Using the earlier of the two is the safe direction: it can only
  // reject a capture that would have been kept, never admit one that should not
  // be. Read BEFORE the fetches so the request budget is not spent on captures
  // that are certain to be rejected, and re-applied to the survivors below.
  const { data: floorRows, error: floorError } = await supabase
    .from("badge_stats")
    .select("polled_at")
    .eq("source", "measured")
    .order("polled_at", { ascending: true })
    .limit(1);
  // A failed read is fatal rather than treated as "no floor": with a null floor
  // every capture would be accepted, and a read error that silently produced a
  // wrong floor would put archived points inside the measured era.
  if (floorError) throw floorError;
  const measuredFloor = (floorRows?.[0]?.polled_at as string | undefined) ?? null;
  const measuredFloorMs = measuredFloor ? new Date(measuredFloor).getTime() : null;

  async function collectCaptures(badge: ArchiveBadgeRow): Promise<CaptureGroup[]> {
    const identifiers = [badge.set_id, badge.slug].filter(Boolean);
    // badgebase's detail path is /b/{numericId}-{slug}/ and the catalog stores
    // no such numeric id, so the page cannot be addressed exactly. The CDX
    // `original` filter below is the server-side stand-in: it is applied in the
    // index BEFORE the limit, so the cap then means "this badge's captures"
    // rather than "the first 200 captures of every badge on the site".
    const badgebasePattern = `.*-${escapeRegExp(badge.set_id)}/`;
    const groups: CaptureGroup[] = [];

    for (const source of [
      { name: "potat", target: `${POTAT_BADGE_BASE}${badge.set_id}` },
      { name: "badgebase", target: BADGEBASE_BASE, pattern: badgebasePattern },
    ]) {
      try {
        const found = await fetchCaptures(source.target, {
          limit: CAPTURE_SCAN_LIMIT,
          originalPattern: source.pattern,
        });
        groups.push({
          name: source.name,
          captures: found.filter((capture) =>
            captureBelongsToBadge(capture.original, identifiers),
          ),
          down: false,
        });
      } catch {
        groups.push({ name: source.name, captures: [], down: true });
      }
    }
    return groups;
  }

  // Phase 1 — one CDX lookup per badge per source. A badge that is skipped
  // still reports as "considered" and is still visible in `skippedDeadline`, so
  // a short run reads as a short run rather than as a smaller catalog.
  const lookups = await mapLimit(badges, concurrency, async (badge) => {
    if (outOfTime()) {
      counters.deadlineReached = true;
      counters.skippedDeadline += 1;
      return { badge, groups: [] as CaptureGroup[], timedOut: true };
    }
    return { badge, groups: await collectCaptures(badge), timedOut: false };
  });

  interface PlannedCapture {
    badgeId: string;
    badgeKey: string;
    capture: ArchiveCapture;
    polledAt: string;
  }
  const planned: PlannedCapture[] = [];
  const sourcesQueried = new Set<string>();
  const sourcesWithHits = new Set<string>();

  for (const { badge, groups, timedOut } of lookups) {
    if (timedOut) continue;
    for (const group of groups) {
      sourcesQueried.add(group.name);
      if (group.down) {
        counters.sourcesUnavailable.add(group.name);
        continue;
      }
      counters.capturesFound += group.captures.length;
      if (group.captures.length > 0) sourcesWithHits.add(group.name);
      // Spread per source, never across sources: a badge can hold a potat and a
      // badgebase capture in the same year, and spreading the merged list would
      // let one source's capture evict the other's.
      for (const capture of spreadByYear(group.captures, maxPerYear)) {
        const date = captureDate(capture.timestamp);
        if (!date) continue;
        // A capture after now() is a clock or parsing artifact, and a future
        // point would be charted as the newest measurement — exactly the
        // "archived point looks like a measured one" failure.
        if (date.getTime() > Date.now()) {
          counters.skippedFuture += 1;
          continue;
        }
        // First application of the invariant, before a single request is spent.
        if (measuredFloorMs !== null && date.getTime() >= measuredFloorMs) {
          counters.skippedNotEarlierThanMeasured += 1;
          continue;
        }
        planned.push({
          badgeId: badge.id,
          badgeKey: badge.set_id,
          capture,
          polledAt: date.toISOString(),
        });
      }
    }
  }

  // A source that answered every lookup and produced nothing is almost always a
  // wrong URL shape rather than an archive that holds none of these badges.
  // Recorded so the run cannot read like a healthy sweep that found nothing.
  for (const name of sourcesQueried) {
    if (!sourcesWithHits.has(name) && !counters.sourcesUnavailable.has(name)) {
      counters.sourcesWithNoCaptures.add(name);
    }
  }
  if (counters.sourcesUnavailable.size > 0) {
    console.warn(
      `[archive] sources unavailable: ${[...counters.sourcesUnavailable].join(", ")}`,
    );
  }

  // Oldest first: the recent tail is what this site already measures, so under a
  // hard request cap the recent captures are the ones worth losing.
  planned.sort((a, b) => a.polledAt.localeCompare(b.polledAt));
  if (planned.length > SNAPSHOT_BUDGET) {
    counters.cappedByRequestBudget = planned.length - SNAPSHOT_BUDGET;
    planned.length = SNAPSHOT_BUDGET;
  }

  // Phase 2 — snapshot fetch + parse. The queue is walked in oldest-first
  // order and stopped at the deadline, so whatever the budget allowed is the
  // oldest history — the part the whole feature exists to recover.
  const snapshots = await mapLimit(planned, concurrency, async (entry) => {
    if (outOfTime()) {
      counters.deadlineReached = true;
      counters.skippedDeadline += 1;
      return { entry, html: null as string | null, timedOut: true };
    }
    try {
      return { entry, html: await fetchSnapshot(entry.capture), timedOut: false };
    } catch {
      return { entry, html: null as string | null, timedOut: false };
    }
  });

  const recovered: RecoveredPoint[] = [];
  for (const { entry, html, timedOut } of snapshots) {
    if (timedOut) continue;
    if (html === null) {
      counters.capturesUnreadable += 1;
      continue;
    }
    counters.capturesFetched += 1;
    // Wayback's own "not archived" / redirect-stub / rate-limit pages parse into
    // nothing and must be counted apart from a genuine capture with no data.
    if (isLikelyArchiveErrorPage(html)) {
      counters.capturesUnreadable += 1;
      continue;
    }
    // badgeKey is what stops a potat page that embeds the whole catalog from
    // resolving to some OTHER badge's owner count.
    const ownerCount = parseArchivedOwnerCount(html, entry.badgeKey);
    if (ownerCount === null) {
      counters.skippedNoValue += 1;
      continue;
    }
    counters.valuesRecovered += 1;
    recovered.push({
      badgeId: entry.badgeId,
      polledAt: entry.polledAt,
      ownerCount,
      sourceUrl: captureUrl(entry.capture),
    });
  }

  // Two captures can share a second — the same instant on two sources, or the
  // same digest reached through a redirect — and the archive partial unique index
  // would reject the second. Collapsed here so the reported count matches the
  // database rather than the parser.
  const pending = new Map<string, RecoveredPoint>();
  for (const point of recovered) {
    const key = `${point.badgeId}|${point.polledAt}`;
    if (pending.has(key)) {
      counters.skippedDuplicate += 1;
      continue;
    }
    pending.set(key, point);
  }

  // Second application: skip anything a previous pass already stored. Read
  // errors throw, as everywhere else in this file.
  //
  // The DB side MUST be normalised through toISOString() before it is keyed.
  // PostgREST returns a timestamptz as `"…44228+00:00"` — microseconds and a
  // `+00:00` offset — while the candidates carry `Date#toISOString()`'s
  // `"…442Z"`. Keyed on the raw strings the two key spaces never intersect, so
  // this whole de-duplication block was a no-op: every re-run re-fetched the
  // full snapshot budget from the archive and only discovered the duplicates at
  // INSERT time, one 23505 and one extra round trip per row. Normalising is
  // exact here because a CDX capture timestamp is a whole second.
  if (pending.size > 0) {
    const badgeIds = [...new Set([...pending.values()].map((point) => point.badgeId))];
    const timestamps = [...pending.values()].map((point) => point.polledAt).sort();
    const { data: existingRows, error: existingError } = await supabase
      .from("badge_stats")
      .select("badge_id, polled_at, source")
      .in("badge_id", badgeIds)
      .gte("polled_at", timestamps[0])
      .lte("polled_at", timestamps[timestamps.length - 1]);
    if (existingError) throw existingError;

    const storedArchiveKeys = new Set<string>();
    for (const row of (existingRows ?? []) as Array<{
      badge_id: string;
      polled_at: string;
      source: string | null;
    }>) {
      if (row.source !== "archive") continue;
      storedArchiveKeys.add(`${row.badge_id}|${new Date(row.polled_at).toISOString()}`);
    }

    for (const point of pending.values()) {
      const key = `${point.badgeId}|${point.polledAt}`;
      if (!storedArchiveKeys.has(key)) continue;
      counters.skippedDuplicate += 1;
      pending.delete(key);
    }
  }

  // THIRD application, immediately before the write, repeated on purpose:
  // never letting an archived point contaminate the measured era is the single
  // invariant this file exists to protect, and the only place it is actually
  // enforced is the one directly in front of the INSERT. The check is in memory,
  // no new query — if this ever fires, the filter above has a hole and that is a
  // bug worth failing loudly on.
  const writable = [...pending.values()].filter((point) => {
    const ms = new Date(point.polledAt).getTime();
    return measuredFloorMs === null || ms < measuredFloorMs;
  });
  counters.skippedNotEarlierThanMeasured += pending.size - writable.length;
  counters.wouldInsert = writable.length;

  if (writable.length === 0) {
    // Normal outcome for a small or brand-new catalog, but it still gets a
    // changelog row so a run that recovered nothing is on the record rather than
    // implied by silence.
    if (!dryRun) {
      await logChange(
        {
          kind: "data_sync",
          title: "Archived owner-series backfill stored nothing",
          body: `${counters.badgesConsidered} badges considered, ${counters.capturesFound} captures found, ${counters.capturesFetched} snapshots read, ${counters.valuesRecovered} owner counts recovered — and every recovered point fell inside the measured era or was already stored. This is the feature working as intended, not a failure.${
            counters.sourcesUnavailable.size > 0
              ? ` Sources unavailable: ${[...counters.sourcesUnavailable].join(", ")}.`
              : ""
          }${
            counters.sourcesWithNoCaptures.size > 0
              ? ` Sources that answered but held nothing: ${[...counters.sourcesWithNoCaptures].join(", ")}.`
              : ""
          }`,
          payload: { ...toSummary(), ranAt: new Date().toISOString() },
        },
        supabase,
      );
    }
    return toSummary();
  }

  if (dryRun) {
    console.log(
      `[archive] dry run — would insert ${writable.length} archived points`,
    );
    return toSummary();
  }

  const toRow = (point: RecoveredPoint) => ({
    badge_id: point.badgeId,
    owner_count: point.ownerCount,
    // An archived capture of a lifetime owner count says nothing about who holds
    // the badge now, so active_count and percentage stay null rather than
    // borrowing the capture's owner number. A null keeps the chart's `active`
    // line free of invented values.
    active_count: null,
    percentage: null,
    polled_at: point.polledAt,
    source: "archive",
    source_url: point.sourceUrl,
  });

  // Chunked, and a plain INSERT — never an upsert. An upsert needs a conflict
  // target, and any target on (badge_id, polled_at) is shared with the measured
  // rows, so an upsert here would let an archived snapshot overwrite a
  // measurement. The `badge_stats_archive_once` partial index covers archive rows
  // only, so a 23505 can therefore only ever mean "already stored" — a
  // concurrent run, or a previous pass — and never "a measured row is in the way".
  try {
    for (const batch of chunk(writable, WRITE_CHUNK)) {
      const rows = batch.map(toRow);
      const { error } = await supabase.from("badge_stats").insert(rows);
      if (!error) {
        counters.inserted += rows.length;
        continue;
      }
      if (!isUniqueViolation(error)) throw error;
      // Postgres aborts the whole statement on a unique violation, so one
      // duplicate would take its batch-mates down with it and the run would
      // under-report what it actually wrote. Re-sent row by row so "already
      // stored" and "written" stay distinguishable.
      for (const row of rows) {
        const { error: rowError } = await supabase.from("badge_stats").insert([row]);
        if (!rowError) {
          counters.inserted += 1;
          continue;
        }
        if (isUniqueViolation(rowError)) {
          counters.skippedDuplicate += 1;
          continue;
        }
        throw rowError;
      }
    }
  } catch (writeError) {
    // The chunks commit independently, so a failure here leaves earlier points
    // live with no changelog row — the undocumented-mutation case the other
    // syncs guard against. Log what was in flight, then rethrow.
    await logChange(
      {
        kind: "data_sync",
        title: "Archived owner-series backfill failed mid-write",
        body: `The backfill aborted on a database error after committing earlier chunks: ${counters.inserted} archived points are already live and up to ${counters.wouldInsert} were in flight. Error: ${message(writeError)}`,
        payload: { ...toSummary(), failed: true, ranAt: new Date().toISOString() },
      },
      supabase,
    );
    throw writeError;
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Archived owner-series backfill",
      body: `${counters.badgesConsidered} badges considered, ${counters.capturesFound} captures found, ${counters.capturesFetched} snapshots read, ${counters.capturesUnreadable} unreadable, ${counters.valuesRecovered} owner counts recovered, ${counters.inserted} archived points inserted. ${counters.skippedNotEarlierThanMeasured} points dropped for falling inside the measured era, ${counters.skippedDuplicate} already stored, ${counters.skippedNoValue} with no recoverable number, ${counters.cappedByRequestBudget} over the request cap.${
        counters.deadlineReached
          ? ` The run hit its wall-clock budget and abandoned ${counters.skippedDeadline} queued items; re-run to continue.`
          : ""
      }${
        counters.sourcesUnavailable.size > 0
          ? ` Sources unavailable: ${[...counters.sourcesUnavailable].join(", ")}.`
          : ""
      }${
        counters.sourcesWithNoCaptures.size > 0
          ? ` Sources that answered but held nothing: ${[...counters.sourcesWithNoCaptures].join(", ")}.`
          : ""
      }`,
      payload: { ...toSummary(), ranAt: new Date().toISOString() },
    },
    supabase,
  );

  return toSummary();
}
