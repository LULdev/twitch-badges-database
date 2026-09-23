-- ============================================================
-- 0037 — least privilege: revoke the write surface nobody granted, and stop
--        new objects from inheriting it
-- ============================================================
-- WHY THIS EXISTS
-- A live-schema audit against these migrations found that `anon` and
-- `authenticated` hold INSERT/UPDATE/DELETE on every public VIEW (all 21
-- non-analytics `stats_*` views plus `collector_stats` and `badge_momentum`) and
-- on the migration ledger `supabase_migrations`. No migration ever granted those:
-- they are the platform default (`pg_default_acl` gives anon/authenticated
-- `arwdDxtm` on every new table in `public`, and EXECUTE on every new function),
-- and only the objects a migration bothered to re-revoke escaped it.
--
-- Today the views are inert — a plain view is not updatable, so a write errors —
-- but the grant is surface that a future `INSTEAD OF` trigger, an auto-updatable
-- view, or a careless `create or replace view` would make live, and the ledger is
-- tooling state that no API role has any business writing.
--
-- The same root cause is fixed at the source: the default privileges for this
-- schema no longer hand out write privileges (or EXECUTE) to the API roles, so the
-- next migration's objects start from nothing and every grant is deliberate.
--
-- Deliberately NOT touched: the table-level UPDATE grant on `profiles`. Narrowing
-- it to column grants would change what the self-service account route may write,
-- and `is_admin`/`twitch_id` are already protected by the `protect_profile_columns`
-- trigger plus `profiles_self_update`'s `auth.uid() = id` check. Recorded here as a
-- known, accepted residual rather than a silent omission.

-- 1) Views are read-only objects. Take the write privileges off every one of them
--    for the API roles. (Wrapped in a DO block so the list is whatever actually
--    exists, not a stale hardcoded one.)
do $$
declare
  v record;
begin
  for v in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v.relname);
  end loop;
end $$;

-- 2) The migration ledger is tooling state, not application data.
revoke all on public.supabase_migrations from anon, authenticated;

-- 3) `blog_views_insert` was left behind when 0023/0024 removed this table's
--    INSERT grant: a policy with no grant behind it is dead surface, and 0024
--    dropped the equivalent policy on its sibling `blog_reactions`.
drop policy if exists blog_views_insert on public.blog_views;

-- 4) `get_own_profile_email()` (an orphan from an earlier prototype, documented in
--    0020) selects `email` from `public.profiles` — a column that does not exist,
--    because email lives in `auth.users`. It would raise 42703 if it were ever
--    called, and nothing in this repository references it.
drop function if exists public.get_own_profile_email();

-- 5) The root cause. Default privileges apply to objects created later, so this is
--    what kept re-arming the surface above. SELECT stays (reads are the common
--    case and each migration grants/revokes reads explicitly anyway); writes and
--    EXECUTE are now opt-in per object.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain on tables
  from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Least privilege: no unintended write grants on views or the migration ledger',
  'A live-schema audit found anon and authenticated holding INSERT/UPDATE/DELETE on every public view (the stats_* set, collector_stats, badge_momentum) and on the supabase_migrations ledger. No migration granted those — they are the platform default ACL, which hands anon/authenticated full DML on every new table in public plus EXECUTE on every new function, and only objects that a migration explicitly re-revoked escaped it. This migration removes the write privileges from every view, revokes all access to the ledger, drops the dead blog_views_insert policy left behind when 0023 removed its grant, drops the orphan get_own_profile_email() function (it selects a profiles.email column that does not exist and would raise 42703 if called), and changes the schema default privileges so future tables no longer inherit write access and future functions no longer inherit EXECUTE.',
  '{"version": "least-privilege-1.0"}'::jsonb
);

notify pgrst, 'reload schema';
