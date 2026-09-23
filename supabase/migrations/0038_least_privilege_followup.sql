-- ============================================================
-- 0038 — finish the least-privilege sweep: the objects 0037 did not reach
-- ============================================================
-- WHY THIS EXISTS
-- 0037 removed the inherited write surface from every public VIEW, from the
-- migration ledger, and from the schema DEFAULT privileges. A follow-up audit of
-- that migration found three objects in the same class that it did not reach.
-- None of them is exploitable today — each is either blocked by RLS or dead
-- because no grant sits behind it — but they are the same unintended surface, and
-- leaving three of a set after removing the rest is how the next reader concludes
-- the sweep was complete.
--
--   1. `user_sync_state` still carried anon/authenticated INSERT/UPDATE/DELETE.
--      RLS (`sync_state_self_all`, `user_id = auth.uid()`) means anon can write
--      nothing and authenticated can only touch its own row, and the application
--      writes this table with the service role — so the grants are unused. SELECT
--      stays: the inventory page reads it with the anon client.
--   2. Sequences kept the default ACL's USAGE/UPDATE. Inert (no table grants
--      INSERT, and PostgREST exposes no sequence verbs), and UPDATE on a sequence
--      would let a caller rewind an identity — worth removing on principle.
--   3. Two policies outlived the grants that made them reachable:
--      `blog_reactions_delete_own` (its DELETE grant was revoked in 0023) and
--      `profile_visits_owner_read` (its SELECT grant was revoked in 0032). A
--      policy with no grant behind it is dead surface that reads like an open
--      door; dropping it changes no behaviour, because it was unreachable.
--
-- NOT fixable here, recorded so the divergence is explicit: the platform's own
-- `supabase_admin` grantor still has a default ACL in `public` that grants the
-- API roles full DML on new tables and EXECUTE on new functions. `postgres` is
-- not a member of `supabase_admin`, so a migration run as `postgres` (which is
-- how `npm run db:apply` runs) cannot alter it. Objects created through the
-- Supabase platform rather than through these migrations will therefore still
-- inherit the old surface; re-check after any platform-side schema change.

-- 1) One unintended write grant left on a table.
revoke insert, update, delete, truncate, references, trigger on public.user_sync_state
  from anon, authenticated;

-- 2) Sequences: no API role has any business reading or advancing one.
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public
  revoke usage, update on sequences from anon, authenticated;

-- 3) Dead policies whose grants are already gone.
drop policy if exists blog_reactions_delete_own on public.blog_reactions;
drop policy if exists profile_visits_owner_read on public.profile_visits;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Least privilege, part two: the objects the first sweep missed',
  'A follow-up audit of migration 0037 found three objects in the same class it had just cleaned. user_sync_state still carried anon/authenticated INSERT/UPDATE/DELETE (unused — RLS scopes writes to the row owner and the application writes it with the service role; SELECT is kept because the inventory page reads it anonymously). Sequences still inherited the default ACL''s USAGE/UPDATE, which would let a caller rewind an identity; they are revoked for the API roles and removed from the default privileges. And two policies outlived the grants that made them reachable — blog_reactions_delete_own (its DELETE grant went in 0023) and profile_visits_owner_read (its SELECT grant went in 0032) — so they are dropped, which changes no behaviour because they were unreachable. The platform-owned supabase_admin default ACL cannot be changed from a migration run as postgres and is recorded as an explicit residual.',
  '{"version": "least-privilege-1.1"}'::jsonb
);

notify pgrst, 'reload schema';
