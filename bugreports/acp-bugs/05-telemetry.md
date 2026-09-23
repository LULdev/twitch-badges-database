# Analytics, statistics tab, status tab and the visitor beacon

Audited:
- `src/lib/analytics.ts` (getAnalytics, classifyUserAgent, runLiveProbes)
- `src/app/api/track/route.ts`
- `src/components/AnalyticsBeacon.tsx`
- `src/app/api/admin/stats/route.ts`, `src/app/api/admin/status/route.ts`
- `src/components/admin/StatsPanel.tsx`, `src/components/admin/StatusPanel.tsx`
- `supabase/migrations/0025_acp_foundation.sql` (analytics_events + the six `stats_analytics_*` views)
- the visitor block of `src/app/[locale]/stats/page.tsx`
- `src/lib/gamification/session.ts` (hashIp / ipHashFromRequest, only as used by the beacon)
- supporting reads: `src/lib/admin-route.ts`, `src/lib/admin.ts` (gate), `src/lib/stats.ts` (UptimeSource shape), message files

Method:
- Read the code above; `grep` for consumers of the analytics/hash functions.
- Read-only DB inspection over `SUPABASE_DB_URL` (`SELECT` only, per the brief): column/view
  existence, live `pg_get_viewdef`, `information_schema.role_table_grants`, `pg_policies`,
  `pg_class.reloptions`. No write was performed (so B1 is proven from grants + policy, not by
  an actual insert — the brief forbids writes).
- Read-only REST calls with the public anon key to confirm the views respond and their JSON
  types (all counts/numerics arrive as JSON numbers, not strings).
- Could not run: `npx tsc --noEmit` / `eslint` (no lint signal relevant to what follows).

Live schema confirmed present and matching the migration: table `analytics_events` (10 columns
as in 0025), all six `stats_analytics_*` views existing with `reloptions = security_invoker=off`,
owned by `postgres`. No drift found in column names or view output keys.

## B1 — the beacon's "bounded on every axis" guarantee is void: `anon` can INSERT directly into `analytics_events`

- **Severity**: high
- **Confidence**: high (grants and policy verified against the live DB; the anon key is verified to
  ship to the browser; an actual INSERT was not executed because the brief forbids writes)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:104-121` (table + policy, never revoked),
  reachable through PostgREST; the clamps it bypasses are in `src/app/api/track/route.ts:46-85`.
- **Code**:
  ```sql
  alter table public.analytics_events enable row level security;
  create policy "analytics_anon_insert" on public.analytics_events
    for insert with check (true);
  ```
  Live grants (SELECT on a view of `information_schema.role_table_grants`):
  ```
  grantee: anon          privilege_type: INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  grantee: authenticated privilege_type: INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ```
  and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is inlined into the browser bundle
  (`src/lib/supabase/browser.ts:10`), so the anon role's key is public.
- **Why it is wrong**: `analytics_events` is a real table in the exposed `public` schema; the
  `anon` role has table-level `INSERT` and a permissive `for insert with check (true)` policy, so
  any visitor (the anon key is public) can `POST /rest/v1/analytics_events` with arbitrary rows.
  This bypasses *every* control the beacon advertises: the 200-char path truncation, the locale
  whitelist, the referrer-host regex, all three `clamp()`s, and — most importantly — the
  server-computed `visitor_hash`, since the caller supplies the hash, `ts`, `path`, `locale` and
  `referrer_host` themselves with no length bound at all. Consequences: `total_hits` /
  `hits_24h` / `online_now` / `unique_visitors` and every `stats_analytics_*` view (and therefore
  the public `/stats` visitor block and the admin Statistics tab) can be driven to arbitrary
  values; rows can be stamped with any `ts` (future or ancient) to poison the 24h/7d/30d/90d
  windows; the table can be grown without limit. The file's own comment calls the endpoint
  "reachable by anyone" and "bounded on every axis", which is exactly what is not true.
  Compare the repo's own pattern: 0021/0023/0024 explicitly `revoke` anon privileges from new
  tables (`follows`, `blog_views`, `blog_reactions`) — 0025 created `analytics_events` (and the
  six views, which also carry inert INSERT/UPDATE/DELETE/TRUNCATE grants to anon/authenticated)
  and never did.
- **How to reproduce**: with the public publishable key, issue
  `POST {SUPABASE_URL}/rest/v1/analytics_events` `apikey: <publishable key>` body
  `{"path":"/<10 000 chars>","visitor_hash":"<arbitrary>","locale":"not-a-locale","ts":"2099-01-01T00:00:00Z"}`.
  (By inspection of the live grants + policy; not executed.) A milder version needs no key at
  all: `POST /api/track` in a loop also inflates the aggregates, since the route has no rate
  limit — but only the direct write defeats the clamping.
- **Suspected cause**: a new public-write table added without revoking the Supabase default
  grants, plus an INSERT policy modelled on "the beacon must be able to write" while the beacon
  actually writes with the service-role client.

## B2 — `stats_analytics_daily.visitors` counts every DNT visitor as one shared visitor

- **Severity**: medium
- **Confidence**: high (view definition read from the live DB)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:140-146`
- **Code**:
  ```sql
  create or replace view public.stats_analytics_daily with (security_invoker = off) as
  select date_trunc('day', ts)::date as day,
         count(*)::bigint as hits,
         count(distinct visitor_hash)::bigint as visitors
    from public.analytics_events
   where ts > now() - interval '90 days'
   group by 1 order by 1;
  ```
  vs. the summary, which does exclude the empty hash:
  `where visitor_hash <> ''` at lines 130 and 135-136.
- **Why it is wrong**: DNT beacons are inserted with `visitor_hash = ''` (`src/app/api/track/route.ts:78`,
  column is `not null default ''`). `count(distinct visitor_hash)` counts `''` as one distinct
  value, so **every DNT visit on a day collapses into exactly one visitor**. On a day whose only
  traffic is DNT, `daily.visitors = 1` while `summary.unique_visitors = 0` — the two aggregates
  contradict each other, and the Statistics tab's visitors trend line is pinned at ≥ 1 for any
  day with traffic, even all-DNT traffic. This is the "GROUP BY / count(distinct) correctness"
  defect, and it directly contradicts the beacon's stated contract ("the online count and
  unique-visitor count exclude them", route.ts:76-77).
- **How to reproduce**: by inspection. Live data currently has zero empty-hash rows
  (`SELECT count(*) … WHERE visitor_hash = ''` → 0), so it is latent until the first DNT hit;
  after one DNT pageview, `SELECT day, visitors FROM stats_analytics_daily` shows 1 for that day.
- **Suspected cause**: the `visitor_hash <> ''` predicate was added to `stats_analytics_summary`
  but not to the `daily` view.

## B3 — live probe reports a broken origin as healthy (any `< 500` is "ok"), for hosts where 4xx is not "up"

- **Severity**: low
- **Confidence**: medium (logic verified; the actual status the three hosts return to a
  `HEAD` from Vercel was not observable from here)
- **Where**: `src/lib/analytics.ts:191-196`
- **Code**:
  ```ts
  const response = await fetch(target.url, {
    method: "HEAD",
    signal: AbortSignal.timeout(4000),
    cache: "no-store",
  });
  return { name: target.name, ok: response.status < 500, ms: Date.now() - started, detail: `HTTP ${response.status}` };
  ```
- **Why it is wrong**: the comment justifies `4xx → healthy` for the Twitch *login* endpoint, but
  the same rule is applied to the root pages of `badgebase.de/` and `potat.app/`. A 403 from
  edge/bot protection (common for `HEAD` from datacenter IPs) or a 404 on the root is reported
  green even when the origin the syncs actually depend on is broken — the "is it up right now"
  question the tab exists to answer. `method: "HEAD"` compounds this: several servers answer
  `405`/`404` to `HEAD` for routes that work with `GET`.
- **How to reproduce**: by inspection; confirm by pointing a target at a host that 403s `HEAD`.
- **Suspected cause**: one reachability rule (`status < 500`) applied uniformly to targets with
  different "healthy" meanings.

## B4 — the database live probe has no timeout, unlike the remote probes

- **Severity**: low
- **Confidence**: low — unverified (I could not force a hung DB connection; `@supabase/supabase-js`
  contains no `AbortController`/timeout around the query, so nothing in this code bounds it)
- **Where**: `src/lib/analytics.ts:168-183`
- **Code**:
  ```ts
  const database: LiveProbe = await (async () => {
    const started = Date.now();
    try {
      const supabase = createAdminClient();
      const { error } = await supabase.from("badges").select("id", { head: true, count: "exact" }).limit(1);
      if (error) throw error;
      return { name: "database", ok: true, ms: Date.now() - started };
  ```
- **Why it is wrong**: the three remote probes are bounded with `AbortSignal.timeout(4000)`, but
  the probe most likely to hang during an actual outage — the database — has no bound at all.
  `GET /api/admin/status` awaits `Promise.all([getPlatformStats(), runLiveProbes()])`, so a
  stalled DB connection leaves the Status tab loading instead of showing "database: down". What I
  could not check: whether Supabase's server-side `statement_timeout`/platform function timeout
  always intervenes first (it bounds a hung *query*, not a stalled *connection*).
- **How to reproduce**: by inspection; hard to reproduce without a network-level stall.
- **Suspected cause**: the timeout was added to the `fetch` probes but not to the Supabase call.

## B5 — StatusPanel renders a literal `—%` for a null success rate

- **Severity**: low
- **Confidence**: high
- **Where**: `src/components/admin/StatusPanel.tsx:131-133`
- **Code**:
  ```tsx
  <td>{pct(Number(source.ok_24h), Number(source.checks_24h)) ?? "—"}%</td>
  <td>{pct(Number(source.ok_7d),  Number(source.checks_7d))  ?? "—"}%</td>
  <td>{pct(Number(source.ok_30d), Number(source.checks_30d)) ?? "—"}%</td>
  ```
- **Why it is wrong**: `pct()` returns `null` when there are no checks, and the `?? "—"` is
  applied to the value *before* the trailing `%`, so a source with no data prints `—%` rather
  than `—`. Cosmetic wrong output, not a style opinion; contrast line 135, which handles the
  same null case correctly (`… ? … : "—"`).
- **How to reproduce**: open the Status tab on a fresh install where a source has `checks_24h = 0`.
- **Suspected cause**: the `%` was placed outside the null-coalescing expression.

## B6 — `avg_duration_s` contract mismatch: the view coalesces to `0`, the type says `number | null`

- **Severity**: low
- **Confidence**: high (view definition + REST response verified)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:137-138` vs `src/lib/analytics.ts:27`
- **Code**:
  ```sql
  (select coalesce(round(avg(duration_s), 1), 0) from public.analytics_events
     where duration_s is not null and ts > now() - interval '30 days')::numeric as avg_duration_s;
  ```
  ```ts
  avg_duration_s: number | null;   // and EMPTY_SUMMARY sets it to null
  ```
- **Why it is wrong**: the interface and `EMPTY_SUMMARY` model "no data" as `null`, but the view
  never returns null — with zero sampled durations it returns `0`, so `summary.avg_duration_s`
  can never be null and the Statistics tab's privacy line shows "Average time on page: 0 s"
  instead of an empty state. (Confirmed live: `avg_duration_s` comes back as the JSON number
  `2.6`, not a string, so the numeric itself is fine — this is purely the null contract.)
- **How to reproduce**: query `stats_analytics_summary` on a DB with no `duration_s` rows → `0`.
- **Suspected cause**: `coalesce(…, 0)` where the client expects null.

## B7 — `/api/admin/stats` computes and ships the full platform payload that the panel never reads

- **Severity**: low
- **Confidence**: high
- **Where**: `src/app/api/admin/stats/route.ts:14-28` vs `src/components/admin/StatsPanel.tsx:14-16`
- **Code**:
  ```ts
  // route.ts
  return { ...analytics, platform: platform ? { gamification, traffic, system, uptime } : null };
  ```
  ```ts
  // StatsPanel.tsx
  interface Payload extends AnalyticsBundle {
    system?: Record<string, number | string | null>;   // declared, never used
  }
  ```
- **Why it is wrong**: `grep` shows StatsPanel never references `platform` or `system`; the route
  still runs the expensive `getPlatformStats()` aggregation and serializes the whole object on
  every tab open, and the declared field name (`system`) does not match the shipped one
  (`platform.system`), so any future attempt to read it silently yields `undefined`. Wasted work
  plus a latent name mismatch.
- **How to reproduce**: by inspection.
- **Suspected cause**: the panel was trimmed to the analytics subset while the route kept the
  combined payload.

---

Notes / deliberately not reported:
- The i18n keys used by both panels and by the public visitor block exist in all eleven
  `messages/*.json` (`admin.stats.kpi.*`, `admin.stats.chart.*`, `admin.stats.privacy` with its
  `{avg}` placeholder, `admin.status.*`, and the twelve `stats.visitors*` / `navVisitors` keys);
  no MISSING_MESSAGE and no placeholder mismatch was found.
- PostgREST returns all counts and numerics from the `stats_analytics_*` views as JSON numbers
  (verified over REST), so the `Number(...)` wrappers in the two panels are defensive, not
  papering over a string bug — no string-as-number defect in this scope.
- **Not a bug (checked and correct)**: `ipHashFromRequest` throws when no salt is configured
  (`src/lib/gamification/session.ts:49-55`) rather than using a guessable fallback, and the
  beacon catches the throw into a 202 drop, so a missing salt degrades to "no analytics", never
  to one shared hash for everyone. `clientIp` correctly prefers `x-real-ip` and otherwise takes
  the rightmost `x-forwarded-for` entry; the hash is not trivially forgeable in production.
- `runLiveProbes` **does** have a 4s timeout on the remote probes (`AbortSignal.timeout(4000)`),
  so B4 is only about the database probe.
- The inert INSERT/UPDATE/DELETE/TRUNCATE grants on the six `security_invoker = off` views are
  not separately exploitable through PostgREST (all six are grouped/subquery views and therefore
  not auto-updatable), but they belong to the same hygiene gap as B1. The views themselves expose
  only aggregates / hosts / paths / client classes — no leak of `visitor_hash` or raw events was
  found (`anon` SELECT on `analytics_events` is denied by RLS, since only the INSERT policy exists).
