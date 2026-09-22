-- v25-02: the first sweep listed five functions but missed
-- `protect_profile_columns()`, which is still executable by PUBLIC, anon and
-- authenticated. A direct call fails with 0A000 (it is a trigger function), so it
-- was never exploitable — but the claim that nothing was anon-reachable was
-- wrong, and it belongs in the same treatment.
--
-- 0020 also needed a portability fix that this file cannot retro-apply to an
-- already-migrated database: its revokes referenced two functions that no
-- migration creates, so on a fresh install it aborted with 42883 and blocked
-- every later migration. 0020's file now guards each revoke with
-- `to_regprocedure(...) is not null`; production already had it applied, so this
-- file carries only the function it missed.

-- v27-01: this file kept the signature-specific guard that 0020 was fixed for —
-- `to_regprocedure('public.protect_profile_columns()')` fails OPEN, so a changed
-- signature would have skipped the revoke silently, and a single-signature revoke
-- would miss any overload. Same overload loop as 0020.
do $$
declare
  sig record;
begin
  for sig in
    select p.oid::regprocedure as s
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'protect_profile_columns'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated', sig.s
    );
  end loop;
end $$;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Function surface: the profile column guard was missed, and the revoke list is now portable',
  'The first sweep revoked five functions but missed protect_profile_columns(), which stayed executable by PUBLIC, anon and authenticated; a direct call fails with 0A000 because it is a trigger function, so it was never exploitable. It is revoked here. The same file also carried a portability defect worth recording: its revokes named two functions that no migration creates, so on a fresh install the migration aborted with 42883 and blocked every later one — the documented setup path could not complete. Migration 0020''s own file now guards each revoke with to_regprocedure, which is a no-op where the function does not exist.',
  '{"version": "function-surface-1.1"}'::jsonb
);

notify pgrst, 'reload schema';