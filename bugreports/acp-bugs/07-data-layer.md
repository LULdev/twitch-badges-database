# The database layer the admin panel depends on

Audited (read, not edited):
- `supabase/migrations/0025_acp_foundation.sql`, `0026_acp_settings_seed.sql`,
  `0027_grant_profile_role_select.sql`, `0028_extend_idea_categories.sql`
- for context and to check what the new objects must fit into:
  `0006_hardening_atomic_counters.sql`, `0008_grant_hardening.sql`,
  `0009_integrity_indexes.sql`, `0010_profile_column_grants.sql`,
  `0021_revoke_profile_column_guard.sql`, `0023_complete_privilege_revoke.sql`,
  `0024_revoke_blog_reactions_insert.sql`, `scripts/db-apply.ts`
- the consumers: `src/lib/settings.ts`, `src/lib/admin.ts`, `src/lib/admin-users.ts`,
  `src/lib/admin-content.ts`, `src/lib/admin-newsletter.ts`, `src/lib/admin-brainstorm.ts`,
  `src/lib/analytics.ts`, `src/lib/roles.ts`, `src/lib/queries.ts`,
  `src/lib/supabase/server.ts`, `src/app/api/track/route.ts`,
  `src/app/api/admin/{setup,users,settings}/route.ts`,
  `src/app/[locale]/stats/page.tsx`, `src/components/admin/{UsersPanel,BadgesPanel,ContentPanel}.tsx`,
  `docs/ACP.md`

Method:
- Read-only `SELECT` over `SUPABASE_DB_URL` (`information_schema.columns`,
  `role_table_grants`, `column_privileges`, `has_table_privilege` / `has_column_privilege`,
  `pg_policies`, `pg_constraint`, `pg_trigger`, `pg_get_functiondef`, `pg_views`,
  `pg_indexes`, `pg_default_acl`, `pg_event_trigger`, row counts). **No write and no
  DDL was executed** — `npm run db:apply` was not run. B1/B2/B4 are therefore proven
  from privileges + policies + trigger bodies, not by firing the exploit.
- `grep` for every table/view/column the ACP libs touch, and for the constants the
  panel writes into checked columns.
- Could not run: nothing was needed from `tsc`/`eslint` — every claim below is about
  the live schema.

Live schema (2026-09-23, 1 profile, 476 badges, 672 ideas, 104 analytics rows,
0 audit/draft/ban rows) matches migrations 0025–0028: all seven ACP tables exist with
the migrated columns, all six `stats_analytics_*` views exist, `profiles.role` exists
with `profiles_role_check ('user','moderator','admin','owner')`, and
`brainstorm_ideas_category_check` carries the thirteen 0028 categories.

## B1 — `profiles.role` is writable by any signed-in member through the public REST API, which promotes them to owner

- **Severity**: critical
- **Confidence**: high (every mechanism verified against the live DB: column privilege,
  policy, trigger body, and the fact that the gate reads exactly this column)
- **Where**:
  - `supabase/migrations/0025_acp_foundation.sql:27-46` — adds `role` and the sync trigger,
    never restricts `role` for client writes
  - `supabase/migrations/0006_hardening_atomic_counters.sql:22-42` — the column guard, whose
    list was not extended
  - the live effect is read at `src/lib/admin.ts:120-133` (`viewerRole`) →
    `src/lib/admin.ts:145-179` (`requireAdmin`)
- **Code** (the guard, live and verbatim):
  ```sql
  create or replace function public.protect_profile_columns()
   ... begin
    if auth.uid() is not null then
      new.id := old.id;
      new.is_admin := old.is_admin;
      new.view_count := old.view_count;
      new.twitch_id := old.twitch_id;
      new.created_at := old.created_at;
    end if;
    return new;
  end;
  ```
  ```sql
  -- 0025:27-46 — role is added and is_admin becomes derived
  alter table public.profiles
    add column role text not null default 'user'
    check (role in ('user', 'moderator', 'admin', 'owner'));
  ... sync_is_admin(): if new.role in ('admin','owner') then new.is_admin := true; ...
  ```
  ```ts
  // src/lib/admin.ts:120-133 — the ACP's only authorization input
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "owner" || role === "admin" || role === "moderator" ? (role as AdminRole) : null;
  ```
- **Why it is wrong**: `role` is the *authorization* column (`viewerRole` reads nothing else),
  and nothing stops a member from writing it:
  - live privilege: `has_column_privilege('authenticated','profiles','role','UPDATE')` → **true**
    (table-level `UPDATE` on `profiles` is granted to `anon`, `authenticated`, `postgres`,
    `service_role`; 0009 only ever revoked `SELECT`, and 0027 only added `SELECT (role)`);
  - live policy: `profiles_self_update` is the **only** UPDATE policy on `profiles`, it is
    `PERMISSIVE`, `USING (auth.uid() = id)` with `WITH CHECK (auth.uid() = id)` — so a member's
    own row is updatable;
  - the guard trigger restores `id`, `is_admin`, `view_count`, `twitch_id`, `created_at` — **not
    `role`**;
  - `profiles_sync_is_admin` then *helps*: it sees `new.role = 'admin'` and sets
    `is_admin := true` on the same update.
  So `PATCH /rest/v1/profiles?id=eq.<own uuid>` with the body `{"role":"owner"}` succeeds and
  the caller is now the owner as far as `/api/admin/**` is concerned. From there: `users` →
  `role` demotes the real owner (`ownerProtected` is `false` for a caller whose role is
  `owner`, see `src/app/api/admin/users/route.ts:104`), `delete` removes them, Settings →
  admins adds grants, and `docs/ACP.md`'s "the login is the authentication, the role is the
  authorization" is inverted. Because the trigger is there to protect `is_admin`, the attacker
  gets both flags set, and `is_admin` becomes readable-by-nobody but *set* — so the audit trail
  (`admin_audit.action = 'role'`? no: nothing writes an audit row on this path) records
  nothing at all.
  This is not a new class: `0006`'s own header (`:6-9`) names exactly this attack — "any
  authenticated user could PATCH protected columns straight through the public REST API —
  including `is_admin` (privilege escalation)" — and `bugreports/FIXES.md:32` records that it
  was fixed for the columns that existed then. 0025 introduced a *stronger* version of the same
  column (`role` outranks `is_admin`, which is now only its mirror) and left it out of the guard.
- **How to reproduce** (by inspection — the brief forbids writes, so the PATCH was not fired):
  1. Sign in with Twitch once (any account; a profile row is created), read your own `id`
     (the JWT `sub`, or `GET /rest/v1/profiles?select=id&uuid=…`).
  2. `PATCH {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.{id}` with headers
     `apikey: {NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
     `Authorization: Bearer {the user's access token}` and body `{"role":"owner"}`.
     PostgREST answers `204`; `select role from profiles where id = …` now reads `owner` and
     `is_admin` reads `true`.
  3. `GET /api/admin/settings` (or any admin route) now returns 200 instead of 403.
  The same PATCH with `{"role":"admin"}` is enough for the whole panel except the owner rails.
- **Suspected cause**: 0025 added the authorization column without widening
  `protect_profile_columns` (and without `revoke update (role) on public.profiles from anon,
  authenticated`); the route-level guards in `admin-users.ts`/`users/route.ts` are the only
  thing standing between a member and this column, and they are not on the path PostgREST uses.
- **Direction (one sentence)**: add `new.role := old.role` to the guard function (or drop the
  `UPDATE` grant on `role` and set the role through a service-role-only path), so the only
  writers are the service-role routes.

## B2 — the six `stats_analytics_*` views are readable by `anon`, but four of them have no public reader; `stats_analytics_top_paths` publishes a raw `path` column

- **Severity**: medium
- **Confidence**: high (grants, view bodies and consumers all verified)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:127-178` (views + the
  `grant select … to anon, authenticated` at `:172-178`);
  consumers: `src/lib/analytics.ts:81-100` (admin API) vs `src/app/[locale]/stats/page.tsx:347,526-570`
- **Code**:
  ```sql
  grant select on public.stats_analytics_summary,
                  public.stats_analytics_daily,
                  public.stats_analytics_top_paths,
                  public.stats_analytics_top_referrers,
                  public.stats_analytics_clients,
                  public.stats_analytics_locales
    to anon, authenticated;
  ```
  ```sql
  create or replace view public.stats_analytics_top_paths with (security_invoker = off) as
  select path, count(*)::bigint as hits
    from public.analytics_events
   where ts > now() - interval '30 days' and path <> ''
   group by path order by hits desc limit 25;
  ```
- **Why it is wrong**: the public `/stats` page renders **only summary fields**
  (`visitors?.summary?.online_now / total_hits / hits_24h / hits_7d / hits_30d /
  unique_visitors`, lines 535-568) — it never reads `paths`, `referrers`, `clients` or
  `locales`; those four are consumed only by `getAnalytics()` for `/api/admin/stats`. Granting
  them to `anon` therefore publishes, with no page needing it, the raw `path` dimension —
  which includes `/xx/profile/<username>` URLs, i.e. *which member profiles are being visited
  and how often* — plus the top 25 external referrer hosts. The site's own privacy copy
  (`visitorsPrivacy`) sits under a block that shows counts and nothing else, so this data is
  readable by anyone even though no page shows it. It composes badly with the anon INSERT path
  (see the cross-reference below): an attacker can seed arbitrary `path` text and it lands in a
  world-readable view. In the repo's own precedent this is a bug class, not a style note —
  0024 revoked an anon write surface precisely because "the route never used it", and 0023
  revokes privileges that have "no purpose".
- **How to reproduce**: `GET {SUPABASE_URL}/rest/v1/stats_analytics_top_paths?select=*` with the
  public publishable key (no auth) returns the top paths; the same request for
  `stats_analytics_top_referrers`, `stats_analytics_clients`, `stats_analytics_locales`
  returns the other admin-only dimensions. `/stats` never displays them.
- **Suspected cause**: the six views were granted as one block in the style of 0004's `stats_*`
  views, without checking which of them a public page actually renders.

## B3 — no database-level bounds on `analytics_events`, the one table both the beacon and the public API can write

- **Severity**: low
- **Confidence**: high (constraint list read from `pg_constraint`; the table has none beyond the PK)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:104-122`;
  the bounds live only in `src/app/api/track/route.ts:43-85`
- **Code**: the table is
  ```sql
  screen_w int, tz_offset_mins int, duration_s int
  ```
  with `path text not null default ''`, `visitor_hash text not null default ''` — and no
  `check` on any of them. The route's own contract is "Bounded on every axis" (`:14-27`):
  `MAX_PATH = 200`, `clamp(screenW, 0, 10000)`, `clamp(tzOffsetMins, -1440, 1440)`,
  `clamp(durationS, 0, 86400)`.
- **Why it is wrong**: the clamps are a property of one JS caller, not of the table.
  `duration_s` is aggregated by `stats_analytics_summary.avg_duration_s`
  (`round(avg(duration_s), 1)`, `0025:137-138`), so a negative or absurd value skews an
  aggregate the Stats tab and the beacon's own documentation present as a bounded
  measurement; unbounded `path`/`visitor_hash` are the vehicle for the aggregate poisoning
  already filed as 05-telemetry B1. The beacon contract would survive a future writer (a
  second endpoint, a script) only if the table itself said what a row may contain.
- **How to reproduce**: by inspection — `select conname from pg_constraint where
  conrelid='public.analytics_events'::regclass` returns only the primary key, while
  `/api/track` asserts four bounds.
- **Suspected cause**: the validation was implemented in the route ("this endpoint is reachable
  by anyone") and never mirrored as CHECK constraints.

## B4 — 0025 adds `profiles.role` but never backfills it, and the sync trigger cannot repair a pre-existing row

- **Severity**: low
- **Confidence**: high by inspection (live impact is currently zero — see below, so this is latent)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:27-46`
- **Code**:
  ```sql
  alter table public.profiles
    add column role text not null default 'user'
    check (role in ('user', 'moderator', 'admin', 'owner'));
  create trigger profiles_sync_is_admin before update on public.profiles
    for each row
    when (new.role is distinct from old.role or new.is_admin is distinct from old.is_admin)
    execute function public.sync_is_admin();
  ```
- **Why it is wrong**: before 0025 the only admin flag was `profiles.is_admin` — which 0006
  deliberately protects *because* an operator sets it by hand (`bugreports/FIXES.md:32`) — and
  `add column … default 'user'` does not fire row triggers, so every existing `is_admin = true`
  row becomes `role = 'user'` / `is_admin = true`, i.e. exactly the state the migration's
  comment says the trigger keeps "in sync". It is then unrepairable by the trigger, because its
  `WHEN` clause only fires when `role` **or** `is_admin` *changes*: a later ordinary profile
  edit (bio, avatar, `view_count` via the RPC) leaves `role = 'user'` untouched, and the ACP's
  `viewerRole` reads only `role`, so that installation's existing staff silently lose the panel
  (and, since a member can restore it — B1 — they would restore it the wrong way). Related
  trap from the same design: because `is_admin` is now derived, `update profiles set
  is_admin = true` (the pre-ACP way to make someone staff, and what 0006's threat model
  assumes) is a silent no-op the trigger immediately reverts, rather than an error.
  **Live check**: `select count(*) from profiles where is_admin = true and role not in
  ('admin','owner')` → 0, and `profiles` holds one row (`role = 'user'`), so nothing is broken
  today — the defect is conditional on an installation that had staff before 0025.
- **How to reproduce**: by inspection, or on a copy: `update profiles set is_admin = true where
  id = …;` then `select is_admin, role` — on any later update that does not change `role`, the
  pair still disagrees; with the guard function in place a member's own write is reverted, so
  only the service role can leave that state.
- **Suspected cause**: 0025 treated the backfill as unnecessary because the project's own
  database happened to have no `is_admin` rows yet.

## Checked and found clean (so "nothing" is meaningful)

- **Every object the ACP libs reference exists in the live DB, with matching types**:
  `site_settings(key,value jsonb,updated_at)`, `bans(profile_id PK, reason, banned_by,
  banned_until timestamptz null = permanent, created_at)`, `newsletter_drafts(… status
  default 'draft', channel default 'push', recipient_count, sent_at)`, `brainstorm_ideas(…
  category, status default 'idea', votes default 0, created_by)`, `admin_audit(actor_id,
  actor default 'bootstrap', action, target default '', payload jsonb)`, `analytics_events`
  (12 columns exactly as in 0025) — no object or column is used by code and missing from the
  migrations. `profiles` has `customization`, `showcase_slots`, `view_count`, `mood`,
  `steal_*`, `theme`, `banner_url`, `bio`, `display_name` — the whole
  `EDITABLE_PROFILE_FIELDS` list and `PROFILE_SELECT`/`PROFILE_PUBLIC_COLUMNS` resolve.
- **Upsert conflict targets all have a matching unique index**:
  `site_settings(key)` PK, `bans(profile_id)` PK, `user_achievements(user_id,achievement_id)`
  PK, `badges(set_id,version)` unique, `blog_posts(slug)` unique. No `42P10` waiting anywhere.
- **Every checked-column vocabulary the panel writes matches the live constraint**:
  `changelog.kind` (8 values = `CHANGELOG_KINDS`), `badges.status` (= `BadgesPanel.STATUSES`,
  `active|upcoming|expired|removed`), `badges.category` is unconstrained (the panel's
  `CUSTOM_BADGE_CATEGORIES` are accepted), `blog_posts.status` (`draft|published`),
  `newsletter_drafts.status/channel` (`draft|sent`, `push|email|both`), `brainstorm_ideas.status`,
  `profiles.role`. `user_progress`'s `xp>=0`, `coins>=0`, `level between 1 and 100`,
  `streak>=0` line up with `setUserProgress`'s clamps (`1..100`, min 0) — no clamp can produce
  a row the DB refuses. `ContentPanel` `JSON.parse`s the changelog payload before sending it, so
  `payload jsonb` never receives a string.
- **0026's seed documents equal the code defaults exactly**: `economy` (13 keys, same values as
  `ECONOMY_DEFAULTS`), `features` (= `FEATURE_DEFAULTS`), `games` `{"enabled":true,"games":{}}`
  (the `getGames` contract), `admin` `{"grants":[]}` — so a seeded row and the in-code fallback
  cannot disagree.
- **RLS is on for all seven ACP tables, and the privacy the panel assumes holds**:
  `site_settings` has only a SELECT policy (an anon INSERT/UPDATE grant exists but no policy, so
  maintenance mode cannot be flipped from outside), `newsletter_drafts` has **no** policy at
  all (unreadable to anon/authenticated despite the table grant), `admin_audit` is readable only
  by the acting profile (`actor_id = auth.uid()`), `bans` only by the banned member
  (`profile_id = auth.uid()`, intended for the ban notice), `brainstorm_ideas` read-only
  publicly. `profiles.is_admin` has **no** SELECT privilege for anon/authenticated (only
  REFERENCES/UPDATE), matching `docs/ACP.md:108`; `twitch_id` stays unreadable per 0009 while
  `potat_connections` is readable by design per 0010.
- **`sync_is_admin` keeps the flags consistent on every path the code uses**: the bootstrap
  route (`role:"owner", is_admin:true`), the panel's `setUserRole` (`role` only), the grant
  action (`.update({role})`, `settings/route.ts:113-116`) and the revoke action
  (`.update({role:"user"})`) all change `role`, so the `WHEN` clause fires and `is_admin`
  follows. It cannot fight the grant action; the only writes it overrules are ones that set
  `is_admin` alone, which no code path does (B4).
- **The aggregate views expose aggregates only** — `0025:127-170` groups by a dimension and
  selects `count(*)`/`count(distinct)`/`avg`; `security_invoker = off` matches 0004's contract,
  the views are owned by `postgres`, and `stats_analytics_summary`/`daily` are the only two a
  public page reads (B2 is about the other four's *grant*, not their contents).
- **No missing index that matters**: the only unbounded table is `analytics_events`, and it has
  `(ts desc)` for the 24h/7d/30d/90d windows and `(visitor_hash, ts desc)` for `online_now`;
  the panel's other lists run against small tables (`badges` 476, `brainstorm_ideas` 672,
  `admin_audit` 0, `newsletter_drafts` 0) where the `order by` sorts are trivially cheap. A
  `profiles(created_at)`/`badges(created_at)` index would be cosmetic at these sizes, so I am
  not filing it.
- **Migration replay**: 0025–0028 reference only objects created by earlier migrations
  (`profiles`, `changelog`) or by Supabase's own bootstrap, the ledger applies each file in one
  transaction (`scripts/db-apply.ts:41-52`), and `0028`'s `drop constraint if exists
  brainstorm_ideas_category_check` matches the name 0025's inline check actually got. The one
  non-obvious dependency is Supabase's default table privileges: the ACP tables get their
  anon/authenticated grants from `pg_default_acl`, not from a `grant` statement in 0025 — the
  live default ACL confirms those grants exist, so a fresh ledger reproduces the live state
  (for `analytics_events` that is exactly what 05-telemetry B1 is about). B4 is the only state
  the replay does not reproduce.

## Cross-references (found independently, already filed — not re-litigated)

- **Idea categories**: `supabase/migrations/0028`'s thirteen categories vs
  `IDEA_CATEGORIES`' seven (`src/lib/admin-brainstorm.ts:10-18`) is 06-newsletter-ideas-audit
  B1 and VERIFIED H1. Re-confirmed live against real data: 176 of 672 rows sit in the six
  categories `saveIdea` rejects (`performance` 45, `usability` 45, `addon` 42, `admin` 15,
  `coin` 15, `xp` 14), so editing any of them from the panel answers 400.
- **`analytics_events` anon INSERT**: 05-telemetry B1 has the full finding (grants + policy
  verified there); B3 above adds only what that report did not cover — that the table carries no
  CHECK constraint at all, so nothing in the schema states the bounds the beacon documents.
- **`profiles.role` writes**: 02-users.md:276 asserts "`profiles.role` writes are constrained by
  the DB check … so B1 is purely an authorization gap, **not a schema violation**". B1 above
  shows that assertion is wrong for the PostgREST path — the check only constrains the *set* of
  values, not *who* may write them — and that assertion is the reason this hole was not filed
  in round 1.
