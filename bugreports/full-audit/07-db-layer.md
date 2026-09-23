# Database layer — migrations vs live schema, grants, RLS, functions, constraints

Audited: every file in `supabase/migrations/` (0001–0031) read in full;
`scripts/db-apply.ts`; `src/lib/queries.ts`, `src/lib/stats.ts`, `src/lib/analytics.ts`,
`src/lib/admin.ts`, `src/lib/admin-users.ts`, `src/lib/inventory.ts`,
`src/lib/settings.ts`, `src/lib/gamification/session.ts`,
`src/app/api/admin/auth/route.ts`, `src/app/api/admin/setup/route.ts`,
`src/app/api/account/route.ts`, `src/app/api/track/route.ts`,
`src/app/[locale]/profile/[username]/page.tsx`, `src/app/[locale]/stats/page.tsx`.
Machine-checked every `.from("…")` / `.rpc("…")` name in `src/` and `scripts/`.

Method: read-only `SELECT` queries against the live database through the project's
own connection string (`SUPABASE_DB_URL`, session pooler) using a throwaway
`postgres` script kept outside the repo; `pg_class` / `pg_policy` / `pg_proc` /
`pg_constraint` / `pg_trigger` / `pg_indexes` / `has_table_privilege` /
`has_column_privilege` / `has_function_privilege` / `pg_relation_is_updatable` /
`information_schema.columns`, plus `set local role anon` / `authenticated` inside a
rolled-back transaction to observe what each role really sees. **No write was
executed** — the one function that would have written (`acp_gate_attempt`) was
assessed from its ACL and body, not called. I could not run `npm run db:apply`
(and did not: it writes), so the from-scratch conclusion is by inspection of the
SQL plus the live ledger, both stated below.

Live server: PostgreSQL 17.6; ledger holds all 31 files (`0001_init.sql` …
`0031_remove_maintenance_mode.sql`, last applied 2026-09-23T07:42:43Z).

---

## B1 — `acp_gate_attempt` is still executable by anon: the bootstrap brute-force throttle can be reset and poisoned from `/rest/v1/rpc`

- **Severity**: high
- **Confidence**: high (grant verified live; grant-defeat mechanics read from the function body; the bootstrap door was verified open live)
- **Where**: `supabase/migrations/0029_acp_security_hardening.sql:141` (and `:86-139`)
- **Code**:
  ```sql
  create or replace function public.acp_gate_attempt(
    p_ip text, p_window_ms bigint, p_max_per_ip int, p_max_total int
  ) returns table(allowed boolean, attempts int, total int)
  language plpgsql security definer set search_path = public
  as $$
  ...
    if now_ms - started > p_window_ms then
      st := jsonb_build_object('windowStartedAt', now_ms, 'byIp', '{}'::jsonb);
  ...
    allowed := ip_cnt < p_max_per_ip and total_cnt < p_max_total;
  ```
  ```sql
  revoke all on function public.acp_gate_attempt(text, bigint, int, int) from anon, authenticated;
  ```
  Live ACL (read from `pg_proc.proacl`): `=X/postgres,postgres=X/postgres,service_role=X/postgres`;
  `has_function_privilege('anon', …, 'EXECUTE') = true`, same for `authenticated`.
- **Why it is wrong**: `create or replace function` leaves the ACL at the default, which
  grants `EXECUTE` to `PUBLIC` (`=X/postgres` is still in the ACL). The `revoke … from
  anon, authenticated` therefore removes nothing, and the role inherits the grant
  through `PUBLIC` — the identical mistake migration 0008 was written to fix (0008 works
  only because 0006/0007 had already done `revoke … from public`). Consequences, because
  the function is `SECURITY DEFINER` (bypasses RLS on `site_settings`) and **every
  parameter is caller-supplied**:
  1. **Throttle reset.** A call with `p_window_ms = 0` executes
     `now_ms - started > 0` unconditionally, so `byIp` is wiped before counting. Because
     `p_ip` is also caller-controlled and need not equal the caller's real address, an
     attacker can reset the window and store the increment under a throwaway key, then
     hit `POST /api/admin/auth` with a fresh 5-attempt budget — indefinitely. The route's
     `MAX_ATTEMPTS = 5` / `MAX_TOTAL_ATTEMPTS = 100` (`src/app/api/admin/auth/route.ts:19-23`)
     is void.
  2. **Lockout.** Calls with many distinct `p_ip` values and a large `p_max_total` push
     `sum(byIp)` past 100 permanently, so the real operator's next bootstrap attempt gets
     `allowed = false` → 429. The counter is only cleared when a call arrives with a
     smaller `p_window_ms`, which the attacker can withhold.
  The state is not merely theoretical: `site_settings.admin` is `{"grants": []}` with no
  `profileId`, so `bootstrapAvailable()` (`src/lib/admin.ts:123-132`) returns **true** —
  the owner-registration door is currently open, and this throttle is its only rate
  limit. The passcode itself is not in the repo (only `BOOTSTRAP_DIGEST`), so the
  residual risk is a remote brute force of the passcode with no attempt cap; how costly
  that is depends on the passcode's entropy, which I cannot see.
- **How to reproduce**: read-only by inspection (I did not execute the write):
  `select has_function_privilege('anon','public.acp_gate_attempt(text,bigint,int,int)','EXECUTE')`
  → `true`; `select proacl from pg_proc where proname='acp_gate_attempt'` → contains
  `=X/postgres`. A `POST /rest/v1/rpc/acp_gate_attempt` with `{"p_ip":"x","p_window_ms":0,
  "p_max_per_ip":1000000,"p_max_total":1000000}` from the anon key therefore resets the
  gate.
- **Suspected cause**: 0029 copied 0008's `revoke … from anon, authenticated` line
  without the `revoke … from public` step that made it effective; the function is also
  `SECURITY DEFINER`, which turns an inert grant into a writable one.
- **Direction**: `revoke all on function public.acp_gate_attempt(text,bigint,int,int) from public, anon, authenticated;`
  (the route calls it with the service-role client, `src/app/api/admin/auth/route.ts:37`),
  and stop trusting caller-supplied `p_window_ms`/`p_max_*` — those belong in the
  function, not in the request.

## B2 — `vote_idea` and `sync_is_admin` keep the same default `PUBLIC` EXECUTE grant (inert today, same ineffective-revoke pattern)

- **Severity**: low
- **Confidence**: high (ACL and privilege verified live)
- **Where**: `supabase/migrations/0029_acp_security_hardening.sql:74`,
  `supabase/migrations/0025_acp_foundation.sql:31-40`
- **Code**:
  ```sql
  -- 0029
  revoke all on function public.vote_idea(bigint, int) from anon, authenticated;
  -- 0025 creates sync_is_admin() and never revokes it at all
  create or replace function public.sync_is_admin() returns trigger
  language plpgsql as $$ ... $$;
  ```
  Live ACLs: both are `=X/postgres,postgres=X/postgres,service_role=X/postgres`;
  `has_function_privilege('anon', …, 'EXECUTE') = true`.
- **Why it is wrong**: both remain callable at `/rest/v1/rpc/<name>` by `anon` and
  `authenticated`, contradicting 0029's own comment ("behind a function the public roles
  cannot execute") and 0020/0021's sweep, which exists precisely to close this surface.
  Neither is exploitable as deployed — `vote_idea` is `security invoker` and neither role
  holds `UPDATE` on `brainstorm_ideas` (0029 granted only `select`), so a call returns
  42501; `sync_is_admin` is a trigger function and a direct call raises `0A000` — but the
  revoke is a no-op, and B1 shows what the same no-op costs when the function happens to
  be `SECURITY DEFINER`.
- **How to reproduce**: by inspection — `has_function_privilege` on both is `true` for
  `anon`, and the ACL string still carries `=X/postgres`.
- **Suspected cause**: revoking from `anon, authenticated` instead of from `PUBLIC`.
- **Direction**: add both names to 0020's overload-robust loop.

## B3 — 19 tables from 0001/0003/0004 still carry the Supabase default `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` grants for `anon` and `authenticated`

- **Severity**: low (unreachable through PostgREST; latent)
- **Confidence**: high (verified live per table)
- **Where**: `supabase/migrations/0001_init.sql:393-401`,
  `0003_gamification.sql:197-206`, `0004_stats_uptime.sql:34`
- **Code** (`0001`, the revoke block that only names DML):
  ```sql
  revoke insert, update, delete on public.badges from anon, authenticated;
  ...
  revoke delete, insert on public.profiles from anon, authenticated;
  grant delete on public.user_inventory to authenticated;
  ```
  Live: `has_table_privilege('anon'|'authenticated', <tbl>, 'TRUNCATE'|'REFERENCES'|'TRIGGER'|'MAINTAIN')`
  is `true` for `activity_events, badge_events, badge_stats, badges, blog_posts,
  changelog, game_rounds, notifications, profile_visits, profiles, push_subscriptions,
  steal_attempts, supabase_migrations, system_heartbeats, turbo_wins, user_achievements,
  user_inventory, user_progress, user_sync_state`.
- **Why it is wrong**: this is the residual of the blanket-grant class the previous round
  closed on the newer tables — 0023 (`blog_views`, `blog_reactions`, `follows`) and 0029
  (the six ACP tables) both revoke the full privilege set, and 0029's own comment notes
  that "TRUNCATE … is NOT subject to row-level security, so a grant of TRUNCATE to anon is
  a table-wipe permission". The original tables never got the same treatment, so each of
  the 19 still hands two browser-facing roles a wipe permission that RLS cannot restrict;
  only the fact that PostgREST exposes no `TRUNCATE`/`MAINTAIN` verb keeps it unreachable
  today.
- **How to reproduce**: by inspection — the single query above; contrast the ACLs of
  `blog_views` / `site_settings` (cleaned) with `badges` / `user_progress` (not).
- **Suspected cause**: the 0001/0003/0004 grant blocks predate the full-privilege revoke
  pattern introduced in 0023/0029.
- **Direction**: one migration that revokes
  `insert, update, delete, truncate, references, trigger, maintain` then re-grants exactly
  the DML each table needs, as 0029 did for the ACP tables.

## B4 — `profile_visits` still grants table-level SELECT to `authenticated`, exposing the `ip_hash` of a profile owner's visitors

- **Severity**: low
- **Confidence**: high (grant and policy verified live; the app's own read path verified in code)
- **Where**: `supabase/migrations/0003_gamification.sql:180-182` + `:197-206`;
  contrast `src/app/[locale]/profile/[username]/page.tsx:97-104`
- **Code**:
  ```sql
  -- 0003: policy is owner-scoped, but the SELECT grant is never narrowed
  create policy "profile_visits_owner_read" on public.profile_visits
    for select using (profile_id = auth.uid());
  ...
  revoke insert, update, delete on public.profile_visits from anon, authenticated;  -- SELECT untouched
  ```
  ```ts
  // the only reader authenticates as the service role and selects one column:
  const admin = createAdminClient();
  const { data: visitorRows } = await admin
    .from("profile_visits")
    .select("visitor:profiles(username, avatar_url)")
    .eq("profile_id", profile.id) ...
  ```
- **Why it is wrong**: `profile_visits` keeps the default table-level `SELECT` for
  `authenticated`, so any signed-in member can `select ip_hash from profile_visits where
  profile_id = <self>` through PostgREST and read the salted IP hashes of everyone who
  viewed their profile — a column the application never renders. The same column-level
  narrowing applied elsewhere on purpose (`profiles` in 0009/0010, `blog_views` /
  `blog_reactions` in 0011/0023, all of which explicitly protect `ip_hash` / `twitch_id`)
  was simply missed here, and the policy comment at `page.tsx:90-92` ("reading it through
  the admin client for every visitor published who had looked at whom") shows the
  exposure was considered and the column path was overlooked. The hash is stable across
  the whole app (one static salt — `src/lib/gamification/session.ts:hashIp` falls back to
  `SUPABASE_SERVICE_ROLE_KEY`), so two members who each own a profile can compare hashes
  and detect that the same visitor looked at both — the deanonymisation the hash is meant
  to prevent.
- **How to reproduce**: `set local role authenticated; select ip_hash from public.profile_visits limit 1;`
  → the column is selectable (0 rows for a caller with no visits, but no 42501); as the
  owner, rows return with the hash. `set local role anon` returns 0 rows.
- **Suspected cause**: 0003 revoked only the write privileges on this table.
- **Direction**: `revoke select on public.profile_visits from anon, authenticated;` and
  re-grant only the columns needed (`profile_id`, `visitor_id`, `created_at`), mirroring
  0011; or drop the client grant entirely since the only reader is the service role.

## B5 — `authenticated` may INSERT its own `user_inventory` rows (grant + policy), overriding the sync-derived truth

- **Severity**: low
- **Confidence**: high on the grants/policies (verified live); medium on impact (transient until the next sync)
- **Where**: `supabase/migrations/0001_init.sql:372-375` + `:400`
- **Code**:
  ```sql
  create policy "inventory_self_insert" on public.user_inventory
    for insert with check (user_id = auth.uid());
  ...
  grant delete on public.user_inventory to authenticated;   -- INSERT/UPDATE never revoked
  ```
  Live: `has_table_privilege('authenticated','public.user_inventory','INSERT') = true`;
  `anon` also holds INSERT/UPDATE/DELETE but its `auth.uid()` is null so every policy is
  false.
- **Why it is wrong**: 0001's stated intent for this block is "API roles never mutate
  catalog/content tables", yet the one table the sync treats as **authoritative-derived**
  (`src/lib/inventory.ts` replaces it from `badges.blog`, with the service-role client)
  is insertable by a member directly. A signed-in member can add arbitrary
  `(user_id = self, badge_id = any)` rows through PostgREST and so inflate the
  `badges_owned` figure the public leaderboard (`collector_stats`) and the badge-count
  achievements read, until the next sync deletes the non-owned rows. No code path uses
  this policy (`grep 'from("user_inventory")'` → the only insert is `inventory.ts:92`
  via `createAdminClient()`), so it is unused surface rather than a needed feature.
- **How to reproduce**: by inspection — grant + `inventory_self_insert` verified live;
  the app's insert is service-role.
- **Suspected cause**: 0001 revoked `insert/update/delete` on the catalog tables but only
  `delete, insert` on `profiles`, and never touched `user_inventory`'s INSERT.
- **Direction**: `revoke insert, update on public.user_inventory from anon, authenticated;`
  and drop `inventory_self_insert` if no in-app claim path is intended.

## B6 — `user_progress` still has no CHECK constraints on nine counters (residue of the earlier `db-5`)

- **Severity**: low
- **Confidence**: high (constraint list read live)
- **Where**: `supabase/migrations/0009_integrity_indexes.sql:8-27` (what was added) vs
  `supabase/migrations/0003_gamification.sql:7-29` / `0007_atomic_counters_gates.sql:21-37`
- **Code**:
  ```sql
  -- 0009 added exactly four checks:
  add constraint user_progress_xp_non_negative check (xp >= 0);
  add constraint user_progress_coins_non_negative check (coins >= 0);
  add constraint user_progress_level_range check (level between 1 and 100);
  add constraint user_progress_streak_non_negative check (login_streak >= 0 and best_login_streak >= 0);
  -- 0007's bump_counters adds deltas with no clamp at all:
  games_won = games_won + coalesce((p_deltas->>'games_won')::int, 0),
  coins_lost = coins_lost + coalesce((p_deltas->>'coins_lost')::bigint, 0),
  ```
- **Why it is wrong**: `xp`, `coins`, `level`, `login_streak`, `best_login_streak`,
  `view_count` and `rarity_score` are constrained, but `games_played, games_won,
  coins_won, coins_lost, wheel_spins, steals_successful, steals_failed, times_robbed,
  achievements_points, game_xp_today` are not — and `bump_counters` applies **unclamped**
  deltas (`greatest(0, …)` is present for `coins`/`xp` in `add_coins`/`apply_xp_coins`,
  but not for these). One negative delta from any writer (a future route, a script, a
  hand-run SQL fix) persists a negative counter that `stats_gamification` then publishes
  as a public aggregate. This is the half of the earlier db-5 finding that 0009 did not
  cover; I report it only because the constraint list is now live-verified rather than
  inferred.
- **How to reproduce**: `select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid='public.user_progress'::regclass` → the nine counters are absent.
- **Suspected cause**: 0009 constrained the columns the app clamps in code and omitted the
  counter family.
- **Direction**: `add constraint … check (games_played >= 0 and games_won >= 0 and
  coins_won >= 0 and coins_lost >= 0 and wheel_spins >= 0 and steals_successful >= 0 and
  steals_failed >= 0 and times_robbed >= 0 and achievements_points >= 0 and
  game_xp_today >= 0)`.

## B7 — 0025 and 0030 are not replayable: bare `CREATE POLICY` / `ADD CONSTRAINT` / `CREATE INDEX`

- **Severity**: low
- **Confidence**: high (read from the files)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:17,56-58,85-86,99-100,119-122`,
  `supabase/migrations/0030_fix_profile_role_escalation.sql:83-89`
- **Code**:
  ```sql
  -- 0025
  create policy "settings_public_read" on public.site_settings for select using (true);
  create index analytics_events_ts_idx on public.analytics_events (ts desc);
  -- 0030
  alter table public.analytics_events
    add constraint analytics_events_path_len check (char_length(path) <= 200),
    add constraint analytics_events_locale_len check (char_length(locale) <= 8);
  ```
- **Why it is wrong**: this is the `db-6` class that 0003 was fixed for, reintroduced by
  the two newest migrations. A lost-ledger or hand-run replay aborts at
  `policy "settings_public_read" … already exists` (42710) and at
  `constraint "analytics_events_path_len" … already exists` (42710), so the rest of the
  file — including 0025's RLS enables and grants, and 0030's function replacement — is a
  hard stop. `scripts/db-apply.ts` wraps each file in one transaction, so the failure is
  atomic (no partial state), and the ledger normally prevents the replay; that is why this
  is low rather than the severity db-6 carried.
- **How to reproduce**: by inspection, or replay 0025/0030 inside a transaction that is
  rolled back.
- **Suspected cause**: the `drop … if exists` convention of 0028/0029 was not applied to
  these two files.
- **Direction**: prefix each `create policy` / `add constraint` / `create index` with its
  `drop … if exists`.

---

## Checked and NOT a bug

- **Ledger vs schema**: all 31 files are in `supabase_migrations` with increasing
  timestamps; every object the migrations create exists live — 30 public tables, 39 views,
  all indexes (including `activity_events_kind_idx`, `profile_visits_visitor_idx`,
  `analytics_events_ts_idx`/`_visitor_idx`), `coin_rain_gate` + its `giver_key` CHECK, the
  `stats_catalog_*` and `stats_analytics_*` views, `consume_and_apply_game_xp`,
  `apply_pair_deltas`, `vote_idea`, `acp_gate_attempt`, the six 0030 CHECK constraints and
  the `game_xp_*` columns. `site_settings` holds only `features`, `economy`, `games`
  (0031's `delete … 'maintenance'` did run) and every `information_schema.columns` row
  matches the migrations column-for-column.
- **From-scratch apply reproduces the live state** — by inspection, file by file: 0001's
  badge guard is a no-op when `public.badges` does not exist; 0019/0020/0021/0022/0023's
  orphan-only statements are no-ops where the object is absent (0020 iterates `pg_proc`
  rows, so two missing names simply yield no statements, and its stale comment about a
  `to_regprocedure` guard describes an earlier revision); 0028/0029/0031 use
  `drop … if exists`. The **only** divergences are the known orphan objects
  `public.follows`, `public.latest_badge_stats(int)` and `public.get_own_profile_email()`
  (accepted earlier, and still absent from the migrations) plus `public.rls_auto_enable()`,
  which Supabase's `ensure_rls` event trigger supplies on any project. No other drift.
- **`supabase_migrations` is not exposed**: `anon`/`authenticated` do hold
  INSERT/UPDATE/DELETE/TRUNCATE (B3) but RLS is enabled with **zero** policies, so the
  grant is inert — verified: `set local role anon; select count(*) from
  public.supabase_migrations` → `0` (same for `authenticated`).
- **`site_settings` keys**: the 0029 policy works. `set local role anon|authenticated;
  select string_agg(key,',') from public.site_settings` → `features,economy,games`; the
  `admin` document (owner id + grant roster) and `acp_gate_state` are unreachable.
- **`profiles` column grants**: verified live — `select id, username, role` and
  `select potat_connections` succeed as `anon`; `select twitch_id`, `select is_admin`,
  and `select *` all fail with `permission denied for table profiles`. No `select("*")`
  on `profiles` exists in `src/`; every read uses `PROFILE_PUBLIC_COLUMNS` /
  `PROFILE_SELECT` (admin client), both of which match the granted/needed column sets.
- **Every `security_invoker = off` view** (all 31 of them: `stats_*`,
  `stats_catalog_*`, `stats_analytics_*`) projects only aggregates plus
  `username`/`avatar_url`; none is auto-updatable (`pg_relation_is_updatable` = 0 for all
  39 views), so the INSERT/UPDATE/DELETE/TRUNCATE privileges `has_table_privilege` shows
  on views are not exploitable. `badge_momentum` and `collector_stats` are correctly
  `security_invoker = true`.
- **Analytics views**: the six `stats_analytics_*` are revoked from both roles (none has
  any grant) and `getAnalytics()` reads them with the service role — no page breaks; the
  public `/stats` page renders `summary` through that service-role path, which is the
  migration's stated design.
- **Trigger order on `profiles`**: `protect_profile_columns` fires before
  `sync_is_admin` (Postgres fires same-event triggers in name order: `…protect…` <
  `…sync…`), so a client PATCH of `role`/`is_admin` is restored before the
  `sync_is_admin` WHEN clause is evaluated and cannot smuggle `is_admin = true`. The 0030
  guard is effective, not order-dependent-by-accident-failure. Live trigger definitions
  match.
- **RLS coverage**: every table has RLS enabled; every table holding a write grant for
  `anon`/`authenticated` has the matching policy (`push_insert`, `inventory_self_insert`
  /`_delete`, `sync_state_self_all`, `profiles_self_update`); every grant-less table
  (`analytics_events`, `newsletter_drafts`, `coin_rain_gate`) has zero policies, i.e.
  deny-all. `anon` reads of `push_subscriptions` and `profile_visits` return 0 rows.
- **No cross-member write path found at the DB layer beyond the ones already reported**:
  `push_subscriptions` (agent-17 db-4 / agent-18 sec-1), `/api/coinrain` (sec-2),
  `/api/blog/react` (sec-5) are unchanged; `/api/account` writes only whitelisted
  non-protected columns (`src/app/api/account/route.ts:37-93`) and is self-scoped;
  `blog_reactions`/`blog_views` INSERT policies are inert because 0011/0023/0024 revoked
  the grants.
- **`/api/track` vs the 0030 CHECKs**: every value the beacon writes is clamped to the
  same bounds the constraints enforce (`path ≤ 200`, `locale` from an 11-value allow-list,
  `referrer_host ≤ 120`, `screen_w 0-10000`, `tz ±1440`, `duration_s 0-86400`), so the new
  constraints cannot silently drop beacons.
- **No secret-bearing data in public reads**: sampled `system_heartbeats`
  (`message`/`payload` are counters and regions) and confirmed `activity_events`,
  `game_rounds`, `notifications` carry only feed/leaderboard data by design.
- **Integrity of the guard trigger**: service-role writes bypass
  `protect_profile_columns` (`auth.uid()` is null), which is what lets the ACP panel and
  the bootstrap flow assign roles; verified `service_role` has `rolbypassrls` and no
  `auth.uid()`. The `/api/admin/setup` path writing `{ role: "owner", is_admin: true }` is
  therefore unaffected.
