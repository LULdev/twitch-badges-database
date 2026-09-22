# Idea agent 09 — developer experience, observability & operational resilience

Scope: this agent read only `README.md`, `AGENTS.md` and `IMPROVEMENTS.md`
(economy rule). The ideas deliberately avoid the four items already listed in
`IMPROVEMENTS.md` §4 (heartbeat metric payload, "no heartbeat for 2 h" alert,
`window.onerror` capture) and §10 (audits in CI, `verify` script, seed
fixtures, invariants in AGENTS.md) — where an idea comes close, it is because
it goes further than what is written there, and it says so.

The recurring hazard this project has: four scraped providers with different
reliability, a 60-second serverless ceiling, 2 daily Hobby crons plus a
15-minute GitHub Actions job, and sync engines whose failure mode is *silence*
(no rows written, a provider field renamed, a sweep that deletes too much).
Ten of the twelve ideas below attack that silence.

---

## Provider contract fixtures: record every payload shape and diff it on each sync
- **Category**: data-quality
- **What**: Commit a small corpus of real recorded responses per provider (`badgebase` RSS + detail page, `potat` `/twitch/badges`, `perfil`, Helix/IVR catalog) and, at the start of every sync, compare the live response's key set and value types against the fixture. A mismatch (renamed field, array became object, null where a number was) is written as a changelog row with `kind = 'provider_drift'` and escalates to a push notification. The province here is not parsing — it is noticing that parsing silently returned `undefined` for a field that used to exist.
- **Touches**: `src/lib/twitch/badgebase.ts`, `src/lib/twitch/potat.ts`, `src/lib/twitch/perfil.ts`, `src/lib/twitch/helix.ts`; new fixture directory alongside them.
- **Failure it prevents**: badgebase renames `data-reset` to `data-ends` and every drop window quietly becomes `null` for weeks, with the imports treated as "still syncing".
- **Effort**: M

## Boundary validation for provider payloads (parse, don't assume)
- **Category**: data-quality
- **What**: Every provider payload crosses one schema guard before any row is built; a payload that fails validation aborts that provider's write and records a heartbeat with the failing field path and the raw sample. Fields that are genuinely optional are marked optional in the schema rather than being coerced with `?? null` at the call site, so "missing" and "empty" stop being the same thing. This is the *validate after sync* counterpart to a dry run: the sync either wrote validated data or wrote nothing and said why.
- **Touches**: the per-provider fetch/normalize functions in `src/lib/twitch/*` and the `withHeartbeat()` wrapper they run under (`src/lib/health.ts`).
- **Failure it prevents**: an owner-count field arrives as a string once; the upsert fails on one chunk and the potat sync half-commits (some badges updated, others stale) with no error surfaced.
- **Effort**: M

## Write-band assertion: a sync that writes an implausible number of rows must shout
- **Category**: observability
- **What**: After each engine finishes, compare rows written/deleted per table against a rolling baseline (previous runs' median plus a tolerance band) and classify the run as `ok`, `suspicious`, or `aborted`. Anything outside the band becomes a changelog row plus a push, naming the table and the delta; the run still commits, so nothing is lost, but a sweep that deleted 100% of the catalog can no longer look like a normal nightly.
- **Touches**: `withHeartbeat()` in `src/lib/health.ts` (extend its payload — the note in IMPROVEMENTS.md §4 only asks for rows/latency/error; this adds the baseline comparison and the verdict) and the three engines in `src/lib/syncs/`.
- **Failure it prevents**: the "badgebase sync is the authoritative activity source" sweep demotes a whole tier of badges to `expired` in one run and the only symptom is users seeing wrong tiers.
- **Effort**: S

## Per-source freshness SLO, exposed both to `/stats` and as curl-able JSON
- **Category**: observability
- **What**: Define a maximum age per data source (catalog, drop windows, owner stats, per-user inventory) and derive a per-source status from the newest row each engine wrote — not from "did the cron tick". `/stats` shows the four staleness gauges next to the existing uptime meter, and `/api/health` returns the same structure as JSON so an external monitor or a GitHub Actions step can assert it. A source that is *ticking but stale* is the exact failure a heartbeat cannot see.
- **Touches**: `src/lib/health.ts` (heartbeats as the source of truth), `src/lib/stats.ts` + `src/components/stats/UptimeGauge.tsx`, `src/app/api/health` route.
- **Failure it prevents**: the 15-minute potat job keeps returning HTTP 200 while its upsert writes nothing, so every badge page shows owner counts frozen at last Tuesday and uptime looks perfect.
- **Effort**: S

## `SYNC_DRY_RUN=1` for every engine: print the diff, write nothing
- **Category**: resilience
- **What**: Give each engine a dry-run mode that runs the full snapshot → diff → plan pipeline and prints the intended inserts, updates, demotions and deletes as a table, then exits without a single write and without a changelog row. Make it the first thing a contributor runs after touching a sync, and document it in the README next to the `npm run sync:*` table. Destructive sweeps (the badgebase demotion, the global status-badge deletion) become reviewable before they are shipped rather than after.
- **Touches**: `src/lib/syncs/` engines and their `scripts/*.ts` entry points; README command table.
- **Failure it prevents**: a filter typo in the demotion sweep silently marks 3 000 active badges expired on the production cron, discovered by a user report.
- **Effort**: M

## `db:verify` migration-drift preflight before deploying code that expects new columns
- **Category**: resilience
- **What**: `npm run db:apply` already has a `supabase_migrations` ledger; add a read-only `npm run db:verify` that compares the ledger against `information_schema` and exits non-zero when a migration file exists on disk but is not recorded as applied, or when the ledger names a migration absent from the repo. Make it the first step of the release ritual so "the code is deployed, the column is not" is caught on the developer's machine, not by catalog queries falling into their `.catch(() => …)` empty states.
- **Touches**: `scripts/` db-apply entry point and its ledger; the `commands` block in AGENTS.md; optionally a pre-deploy step.
- **Failure it prevents**: a stats page ships against a view added in a new migration; the migration was never applied on production, but `.catch(() => …)` renders an empty chart instead of an error, so nobody looks for two days.
- **Effort**: M

## `verify:deploy` — an automated post-deploy smoke check against production
- **Category**: developer-experience
- **What**: A script that, given the production URL, asserts response status and a content marker for a fixed short list: `/api/health`, the sitemap, one badge detail page in each of the 11 locales (to catch `MISSING_MESSAGE`, which the build does not fail on), and the RSS/changelog feed. It runs optionally from a GitHub Actions step after the Vercel deployment finishes, and prints a compact pass/fail table. This is not the CI `verify` script from IMPROVEMENTS.md §10 — it checks the *deployed artifact*, which is the only place a locale or RLS breakage becomes visible.
- **Touches**: new script under `scripts/`; `.github/workflows/` (the same place the 15-minute potat job lives); README deployment section.
- **Failure it prevents**: a locale-key or dynamic-message regression builds green, deploys, and only the `de` and `ja` pages throw at request time; the check pinpoints the locale in the table.
- **Effort**: S/M

## One shared provider-fetch wrapper: timeout, classified errors, and a circuit breaker
- **Category**: resilience
- **What**: Today each provider has its own retry behaviour (potat honours `Retry-After`, others differ). Consolidate them behind a single `fetchJson` that applies a hard per-request timeout, classifies errors (network / 4xx-contract / 429 / 5xx), counts consecutive failures per provider, and opens a breaker for the remainder of the run once a provider is clearly down. The breaker state is written into the heartbeat so "we skipped badges.blog on purpose" is legible in the data rather than a mystery of missing rows.
- **Touches**: `potatFetch` in `src/lib/twitch/potat.ts` and the sibling fetchers in `helix.ts`, `badgebase.ts`, `perfil.ts`.
- **Failure it prevents**: a hung provider consumes the 60-second function budget one request at a time, the whole cron returns 504, and the *other* three providers that were healthy never got their turn.
- **Effort**: M

## Sync cost and time budget guard (serverless wall clock + external call volume)
- **Category**: resilience
- **What**: Instrument each engine with its wall-clock time and its outbound call count, and assert both against an explicit budget derived from the platform limits (60 s per serverless invocation; a polite call ceiling for the ToS-sensitive providers). When a run approaches the budget it stops taking new work, commits what it has, and records a `partial` heartbeat instead of being killed mid-flight. The numbers are also the honest answer to "what does this cost on Hobby".
- **Touches**: `src/lib/syncs/` engines, `withHeartbeat()` payload, the chunked potat upsert that AGENTS.md pins at ~6 s.
- **Failure it prevents**: as the catalog grows, the potat sync silently crosses the 60 s ceiling and is killed after writing half its chunks — a permanently half-updated table that no heartbeat ever marks as failed.
- **Effort**: M

## Locale parity audit as a script, run before every release
- **Category**: developer-experience
- **What**: A small checker that loads all 11 `messages/*.json`, reports keys present in one file and missing in another, and distinguishes *unreferenced* keys from *missing* ones. Wire it into the `verify` script and print the drift as a compact per-locale table. The build cannot enforce key-identity across files by itself, and AGENTS.md's warning to "check the build log for MISSING_MESSAGE" is a manual ritual that a script should own.
- **Touches**: `messages/*.json`, `src/i18n/routing.ts` (`Locale` is already a closed union), the `npm run verify` script from IMPROVEMENTS.md §10.
- **Failure it prevents**: a new feature adds keys to `en.json` only; nine locales render the raw key to users, and the only signal is a line in a build log nobody reads.
- **Effort**: S

## Provider registry: adding a provider becomes one file, not an engine edit
- **Category**: developer-experience
- **What**: Define one interface a provider implements (`capabilities` — catalog / enrichment / owner stats / per-user ownership — plus a `fetch` and a `normalize`), and have the sync engines iterate a registry instead of calling providers by name. Each provider gets its own heartbeat entry, its own freshness SLO and its own breaker state for free. Adding a fifth source (or making a second source authoritative for one capability) then touches one new file, not the three engines, and the "which source wins" decision becomes data in the registry rather than an if-branch buried in a sync.
- **Touches**: `src/lib/twitch/*` and `src/lib/syncs/`; the authority rules currently expressed as comments in AGENTS.md (badgebase authoritative for activity, perfil with GQL fallback).
- **Failure it prevents**: a new provider is added with subtly different fallback semantics, the two engines disagree about which source wins, and the catalog flickers between values on every other sync.
- **Effort**: L

## Sync-anomaly review on the changelog page: make a bad sync visible before a user reports it
- **Category**: data-quality
- **What**: The changelog table already records every mutation, so it can answer questions nobody currently asks it: which sync run deleted the most rows, which run moved the most badges between rarity tiers, which run inserted with unusually empty fields. Add a filterable `/changelog` view for sync `kind`s plus a nightly rollup that flags the day's outliers, and let a maintainer confirm or annotate a run. It converts an append-only audit stream into an operational review surface, at the cost of a query rather than a new pipeline.
- **Touches**: `src/lib/changelog.ts`, the `/changelog` page, and the changelog rows every engine already writes (per the AGENTS.md rule).
- **Failure it prevents**: a rarity recomputation bug shifts every badge up one tier in a single run; it is materially a data incident, but today the changelog shows it as one ordinary row among thousands.
- **Effort**: M