# Agent 12 — cron-health audit

## cron-1: Unauthenticated `/api/health` performs a DB write on every request (write amplification)
- **Severity**: high
- **Side**: server
- **File**: src/app/api/health/route.ts:15,50
- **Evidence**: `export async function GET() {` … `await recordHeartbeat({ source: "web", status, durationMs: totalMs, message: error, payload: {…} });` — the endpoint is public by design ("Deliberately unauthenticated") and inserts a row into `system_heartbeats` through the service-role client on every call.
- **Why it is a bug**: Any anonymous client can issue GETs in a loop and grow `system_heartbeats` without bound. The only cleanup is `pruneHeartbeats(90)` in the global cron, which runs once a day and is skipped whenever the global sync throws (see cron-4). A modest flood of a few hundred requests/sec exhausts table storage/IO before any prune can run, degrading the same observability table that `/stats` reads.
- **Confidence**: confirmed
- **Fix direction**: Drop the per-request heartbeat for anonymous probes (reuse a cached/edge-cached result), or require the `CRON_SECRET`/rate-limit by IP before writing the row.

## cron-2: Global cron returns HTTP 200 `{ok:true}` when badgebase enrichment failed
- **Severity**: medium
- **Side**: server
- **File**: src/app/api/cron/global/route.ts:38-42,56
- **Evidence**:
  ```ts
  try { badgebase = await withHeartbeat("sync/badgebase", () => runBadgebaseSync()); }
  catch (error) { console.error("[cron/badgebase]", error); }   // swallowed
  ...
  return Response.json({ ok: true, summary, badgebase, durationMs, pruned });
  ```
- **Why it is a bug**: The badgebase enrichment is the authoritative activity source (AGENTS.md: badges on `/active` get `is_confirmed_active`; everything else is demoted to `expired`). When it fails, the handler still answers `200 ok:true`. Schedulers/monitors treat HTTP 200 as success, so a day-long badgebase outage silently demotes/skips activity state with no failing signal; only the `cron/global` heartbeat row says "degraded", which nothing pages on.
- **Confidence**: confirmed
- **Fix direction**: Return a non-2xx (e.g. 207/500) or `ok:false` when `badgebase` is null, so the failure is visible to the scheduler.

## cron-3: Heartbeat retention prune is unreachable whenever the global sync fails
- **Severity**: medium
- **Side**: server
- **File**: src/app/api/cron/global/route.ts:23-35,45
- **Evidence**: the `catch` block at lines 23-35 returns 500 *before* line 45 `const pruned = await pruneHeartbeats(90);`. `pruneHeartbeats` is called nowhere else.
- **Why it is a bug**: Pruning is coupled to the least reliable step. If `runGlobalSync()` keeps failing (helix/ivr/badgebase outage, missing env), every run returns early and the heartbeat table grows forever — exactly when failure diagnostics matter most. Combined with cron-1's unauthenticated writes this is an unbounded-growth path.
- **Confidence**: confirmed
- **Fix direction**: Run `pruneHeartbeats` in a `finally` (or move it to its own always-reached block) so retention does not depend on sync success.

## cron-4: `db:apply` ledger insert is not atomic with the migration → destructive 0001 can re-run
- **Severity**: medium
- **Side**: server
- **File**: scripts/db-apply.ts:45-51
- **Evidence**:
  ```ts
  for (const name of pending) {
    const text = readFileSync(resolve(migrationsDir, name), "utf8");
    await sql.unsafe(text);
    await sql`insert into supabase_migrations (name) values (${name})`;
  }
  ```
- **Why it is a bug**: The migration body and its ledger row are two separate statements outside a transaction. If the process dies/is killed between them (network drop, timeout, OOM), the migration applied but is still "pending"; the next run re-applies it. For the destructive 0001 (`replace` of prior schema, per the comment at lines 25-28) a re-run wipes the live catalog. The guard is also a custom `supabase_migrations` table, not Supabase's own ledger — a DB migrated by any other means starts with an empty set and re-applies everything.
- **Confidence**: likely
- **Fix direction**: Wrap each migration + its ledger insert in one transaction (`sql.begin`), and never auto-apply files matching the destructive migration on a non-empty catalog.

## cron-5: Secret comparison is not constant-time and `maxDuration` mismatches the work
- **Severity**: low
- **Side**: server
- **File**: src/app/api/cron/global/route.ts:12; src/app/api/cron/potat/route.ts:11; src/app/api/cron/badgebase/route.ts:11
- **Evidence**: `if (!secret || auth !== \`Bearer ${secret}\`) { return Response.json({ error: "unauthorized" }, { status: 401 }); }` — plain `!==` string compare in all three routes.
- **Why it is a bug**: `!==` short-circuits on the first differing byte, so response timing leaks the secret prefix. Over a network the signal is tiny (low severity), but it is a genuine non-constant-time compare of a bearer secret. Related: the route caps at `maxDuration = 60` while `.github/workflows/potat-sync.yml:26` allows `--max-time 240`, so a sync needing >60s is killed by Vercel and the 240s budget is unreachable.
- **Confidence**: confirmed (compare) / unconfirmed (>60s runs)
- **Fix direction**: Compare with a timing-safe equal (e.g. `crypto.timingSafeEqual` on equal-length buffers). Align the workflow `--max-time` with the route's real `maxDuration` (or raise the route cap).

## cron-6: `cron/global` "degraded" derived from summary truthiness, not from an error
- **Severity**: low
- **Side**: server
- **File**: src/app/api/cron/global/route.ts:50-52
- **Evidence**: `status: badgebase ? "ok" : "degraded", message: badgebase ? null : "badgebase enrichment failed"`
- **Why it is a bug**: The health status is inferred from whether `runBadgebaseSync()` returned a truthy value. A legitimate no-op/empty result (returning `null`/`undefined`, e.g. no catalog rows yet) is recorded as "badgebase enrichment failed", producing false degraded heartbeats and polluting the uptime view. The real failure reason is already captured by the inner `withHeartbeat` error row.
- **Confidence**: likely
- **Fix direction**: Track an explicit `badgebaseFailed` boolean set in the `catch`, and base `status` on that rather than on the summary's truthiness.