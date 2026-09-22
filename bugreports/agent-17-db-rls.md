# agent-17 — db-rls audit

Scope: `supabase/migrations/0001..0007`, `src/lib/queries.ts`, `src/lib/stats.ts`.
Read-only audit; no DB access, so grant/privilege conclusions are marked accordingly.

## db-1: 0006/0007 economy functions revoke EXECUTE only from PUBLIC, leaving anon/authenticated
- **Severity**: medium
- **Side**: server
- **File**: supabase/migrations/0006_hardening_atomic_counters.sql:85-90, supabase/migrations/0007_atomic_counters_gates.sql:147-154
- **Evidence**:
  ```sql
  -- 0007
  revoke all on function public.bump_counters(uuid, jsonb) from public;
  revoke all on function public.claim_daily_gate(uuid, date) from public;
  ...
  grant execute on function public.bump_counters(uuid, jsonb) to service_role;
  ```
- **Why it is a bug**: Supabase's install sets `alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role`, so a function created in `public` holds an **explicit** grant to `anon`/`authenticated`, not just the implicit `PUBLIC` grant. `revoke … from public` therefore does not remove it, and all seven economy RPCs (`add_coins`, `apply_xp_coins`, `bump_view_count`, `bump_counters`, `claim_daily_gate`, `claim_wheel_gate`, `consume_game_xp`) stay reachable at `/rest/v1/rpc/<name>` by anonymous clients — the exact case the file header claims to prevent ("EXECUTE-restricted to the service role"). Note that every *table* revoke in 0001/0003 correctly names `anon, authenticated`; only the function revokes use the ineffective form. Practical impact today is limited to defense-in-depth: the functions are `security invoker` and their target tables (`user_progress` has only a SELECT policy; `profiles` update policy is self-only plus the 0006 column trigger) make an anonymous call a silent no-op — so this is not currently mintable currency, but it removes the layer the migration believed it had added.
- **Confidence**: likely (grantee lists cannot be read without live DB / `information_schema` access)
- **Fix direction**: `revoke execute on function public.<fn>(<args>) from public, anon, authenticated;` before granting to `service_role`.

## db-2: anon/authenticated may INSERT into `blog_reactions` (grant never revoked)
- **Severity**: medium
- **Side**: server
- **File**: supabase/migrations/0003_gamification.sql:176-181, 191
- **Evidence**:
  ```sql
  create policy "blog_reactions_insert" on public.blog_reactions
    for insert with check (true);
  ...
  revoke delete on public.blog_reactions from anon;   -- insert/update never revoked
  ```
  Contrast 0003:190 `revoke insert, update, delete on public.blog_views from anon, authenticated;`
- **Why it is a bug**: The whole reaction path is server-written with the service-role client (`src/app/api/blog/react/route.ts:17` `createAdminClient()`, then select/delete/insert), yet the table keeps Supabase's default INSERT grant and gives it a `with check (true)` policy. Any anonymous caller can POST arbitrary rows to `/rest/v1/blog_reactions` with an attacker-chosen `ip_hash`, inflating `stats_traffic.blog_reactions` (surfaced publicly on `/stats`), and can `DELETE` rows whose `user_id` is null via the `blog_reactions_delete_own` policy path (0003:178-179 matches `user_id = auth.uid()`, which is null for anon rows). The only integrity guard is the non-cryptographic unique `(post_id, ip_hash, emoji)`.
- **Confidence**: confirmed
- **Fix direction**: `revoke insert, update, delete on public.blog_reactions from anon, authenticated;` (keep only the service role) and drop the unused policies.

## db-3: `profiles` is world-readable and `select("*")` exposes `twitch_id` and potat enrichment
- **Severity**: medium
- **Side**: server
- **File**: supabase/migrations/0001_init.sql:336-337 + supabase/migrations/0002_status_rarity_potat.sql:13-18 + src/lib/queries.ts:365-369
- **Evidence**:
  ```sql
  create policy "profiles_public_read" on public.profiles for select using (true);
  ...
  alter table public.profiles
    add column if not exists potat_level int, ... add column if not exists potat_connections jsonb;
  ```
  ```ts
  const { data } = await supabase.from("profiles").select("*").ilike("username", pattern).maybeSingle();
  ```
- **Why it is a bug**: 0006:8 lists `twitch_id` as a protected column precisely because it enables "identity matching", but the same table grants anonymous SELECT of that column (plus `potat_connections` — third-party platform ids — `view_count`, `steal_price`, `steal_max`, `mood`, `customization`) to anyone, and the profile page queries `*`, so the whole row leaves with the anon key. An attacker can walk `/profile/<username>` for every user and build a Twitch-id → account mapping that the writers were deliberately blocked from tampering with. (Email is genuinely absent — that part of the design holds.)
- **Confidence**: confirmed
- **Fix direction**: replace `select("*")` with an explicit public projection (`id, username, display_name, avatar_url, bio, color, banner_url, theme, showcase_slots, inventory_public, created_at`) and/or move `twitch_id`/`potat_connections` behind a service-role-only view or column-level `revoke select (…) on public.profiles from anon, authenticated`.

## db-4: `push_subscriptions` INSERT is unrestricted and can be created under any `user_id`
- **Severity**: medium
- **Side**: server
- **File**: supabase/migrations/0001_init.sql:363-369
- **Evidence**:
  ```sql
  create policy "push_insert" on public.push_subscriptions for insert with check (true);
  create policy "push_self_read" on public.push_subscriptions for select using (user_id = auth.uid());
  create policy "push_self_delete" on public.push_subscriptions
    for delete using (user_id = auth.uid() or user_id is null);
  ```
- **Why it is a bug**: `with check (true)` never constrains `user_id` (the column is nullable and has no default tying it to the caller), so an anonymous caller can POST `{user_id: "<victim uuid>", endpoint: <attacker endpoint>, …}` and subscribe their own endpoint to another account's targeted notifications; the attacker can read nothing (`push_self_read` is owner-scoped), but every notification addressed to that `user_id` is then delivered to the attacker's endpoint. Separately, `push_self_delete` lets any anonymous caller delete **all** rows with `user_id is null` — i.e. every anonymous subscriber — because the `or user_id is null` arm is true for anon.
- **Confidence**: confirmed
- **Fix direction**: `with check (user_id is null or user_id = auth.uid())` and split the delete policy into `using (user_id = auth.uid())` plus a separate endpoint-keyed delete for anonymous rows.

## db-5: economy columns have no CHECK constraints although the code assumes non-negative / bounded values
- **Severity**: medium
- **Side**: server
- **File**: supabase/migrations/0003_gamification.sql:7-29
- **Evidence**:
  ```sql
  create table if not exists public.user_progress (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    xp bigint not null default 0,
    coins bigint not null default 0,
    level int not null default 1,
    ... games_won int not null default 0, coins_won bigint not null default 0, ...
  );
  ```
- **Why it is a bug**: The only thing keeping `coins`/`xp` non-negative is the `greatest(0, …)` inside `add_coins`/`apply_xp_coins` (0006:56-81). Any other writer — a script, a migration, a future route using a plain UPDATE, and `bump_counters` (0007:26-34), whose per-column deltas are **not** clamped (`coins_won = coins_won + delta` can go negative) — can write negative balances, and `level` accepts 0 or 1e9 with no bound even though the app ships levels 1–100 and `stats_levels` (0004:68-77) buckets by that value and `stats_gamification.max_level` (0004:60) reports it publicly. Nothing at the DB layer contradicts a broken write.
- **Confidence**: confirmed
- **Fix direction**: add `check (coins >= 0)`, `check (xp >= 0)`, `check (level between 1 and 100)`, and `check (games_played >= 0 and games_won >= 0 …)` (clamp in `bump_counters` too).

## db-6: 0003 is not re-runnable — `create table if not exists` paired with bare `create policy`
- **Severity**: low
- **Side**: server
- **File**: supabase/migrations/0003_gamification.sql:150-181
- **Evidence**:
  ```sql
  alter table public.user_progress enable row level security;
  ...
  create policy "progress_public_read" on public.user_progress for select using (true);
  ```
  (no `drop policy if exists` before any of the 13 policies; 0004:29 does use `drop policy if exists`.)
- **Why it is a bug**: Every table in this file is created with `if not exists`, signalling split-and-re-runnable intent, but the policies are created unconditionally. Re-applying 0003 — a rebuilt ledger, a manual psql replay, a partially applied run — aborts at the first policy with `policy "progress_public_read" for table "user_progress" already exists`, leaving the rest of the migration (including the grants, 0003:184-192) unapplied. 0001 avoids this only by dropping its tables first; 0004/0006/0007 are idempotent.
- **Confidence**: confirmed
- **Fix direction**: `drop policy if exists "<name>" on public.<table>;` before each `create policy`, as 0004 does.

## db-7: 0001 drops the live catalog and profiles with `cascade`, destroying all user data on re-run
- **Severity**: low
- **Side**: server
- **File**: supabase/migrations/0001_init.sql:9-32
- **Evidence**:
  ```sql
  drop table if exists
    public.user_webhooks, ... public.profiles, public.badges
    cascade;
  ```
- **Why it is a bug**: This is an unconditional destructive statement covering the production tables, not just the old prototype ones. If 0001 is replayed on a database that has data (ledger lost, `supabase db push` against the wrong project, a hand-run migration), the `cascade` takes `badge_stats`, `badge_events`, `user_inventory`, `push_subscriptions`, and — through the `references public.profiles (id) on delete cascade` FKs added in 0003 — every row of `user_progress` (all XP, coins, levels, streaks), `activity_events`, `game_rounds`, `steal_attempts`, `profile_visits`, `user_achievements` and `turbo_wins` with it. There is no guard (no `to_regclass` check, no environment condition, no backup step) and the accompanying `insert into public.changelog`/`blog_posts` seeder runs again too.
- **Confidence**: confirmed
- **Fix direction**: restrict the drop list to the prototype tables actually being replaced, or wrap the destructive block in a guard that only fires when the catalog is empty (`do $$ … if not exists (select 1 from public.badges limit 1) then … end $$;`).

## db-8: no index on `activity_events.kind`, which the /stats views scan on every load
- **Severity**: low
- **Side**: server
- **File**: supabase/migrations/0003_gamification.sql:47-50 + supabase/migrations/0004_stats_uptime.sql:145-155, 211-218
- **Evidence**:
  ```sql
  create index if not exists activity_events_created_idx on public.activity_events (created_at desc);
  create index if not exists activity_events_user_idx on public.activity_events (user_id, created_at desc);
  ```
  ```sql
  -- 0004
  create or replace view public.stats_activity_kinds ... from public.activity_events group by kind;
  create or replace view public.stats_badge_claims ...
    (select count(*) from public.activity_events where kind = 'badge_claim')::bigint as claims, ...
  ```
- **Why it is a bug**: `activity_events` grows with every XP gain, game round, achievement and profile view (the write-heavy feed), and the two views filter/group by `kind` over the whole table; `stats_badge_claims` even evaluates three separate `kind = '…'` sub-selects. With only `created_at` and `user_id` indexed, each `/stats` render forces a full sequential scan of the largest table — the one column combination actually queried is unindexed.
- **Confidence**: confirmed
- **Fix direction**: `create index if not exists activity_events_kind_idx on public.activity_events (kind, created_at desc);` (also serves the 24h filter inside `stats_activity_kinds`).

---
Not reported as bugs after checking: no definer view exposes `profiles.email` (0004's `security_invoker = off` views project only aggregates plus `username`/`avatar_url`); `badge_momentum` and `collector_stats` correctly use `security_invoker = true`; every RLS-enabled table in scope has a policy or is intentionally service-role-read-only (`blog_views`, `blog_reactions` reads happen through `createAdminClient` in `src/app/[locale]/blog/[slug]/page.tsx:62-63`); `claim_daily_gate` / `claim_wheel_gate` / `consume_game_xp` compare-and-set logic is genuinely race-free; and `src/lib/stats.ts` guards every view read, so un-migrated views render empty states.