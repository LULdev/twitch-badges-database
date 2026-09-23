-- ============================================================
-- 0039 — the last two dead grants from the round-nine audit
-- ============================================================
-- WHY THIS EXISTS
-- The round-nine audit verified 0038 (no break) and then found two more objects
-- of the same class, plus one gap in 0038 itself:
--
--   1. `anon` holds a table-level UPDATE on `profiles`. The authenticated half is
--      the deliberate residual 0037 recorded (the account route needs it), but
--      `profiles_self_update` requires `auth.uid() = id`, and `auth.uid()` is NULL
--      for anon — that grant can never match a row. Removing it takes away nothing
--      that any path uses.
--   2. 0038 revoked USAGE and UPDATE from the sequence default privileges but left
--      SELECT, while its own comment says no API role has any business reading a
--      sequence. No existing sequence carries an API-role grant, so this only
--      affects sequences created later — which is exactly the point of a default.
--   3. `user_sync_state` and the ledger were cleaned in 0038; re-checked here and
--      already clean, so nothing further is needed for them.

-- 1) Dead UPDATE surface: anon can never satisfy `auth.uid() = id`.
revoke update on public.profiles from anon;

-- 2) Complete 0038's sequence default: neither read nor advance.
alter default privileges in schema public
  revoke select, usage, update on sequences from anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Least privilege, part three: the anonymous profile grant and the sequence default',
  'The round-nine audit verified that migration 0038 broke no application path and then found two more objects of the same class. anon still held a table-level UPDATE on profiles: the authenticated half is the deliberate residual the account route needs, but profiles_self_update requires auth.uid() = id and auth.uid() is NULL for anon, so that grant could never match a row and is removed. And 0038 revoked USAGE/UPDATE from the sequence default privileges while leaving SELECT, contradicting its own stated intent, so the sequence default is now fully revoked for the API roles. No existing sequence ever carried an API-role grant, so this only shapes sequences created from here on.',
  '{"version": "least-privilege-1.2"}'::jsonb
);

notify pgrst, 'reload schema';