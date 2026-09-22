-- v26-03: production carries `public.follows` — RLS on, four policies (anon and
-- authenticated SELECT, authenticated insert/update/delete on own rows), 0 rows —
-- that no migration creates and no code references. Same provenance class as the
-- two orphan RPCs closed in 0020/0021: a leftover from an earlier prototype.
--
-- Its table grants are broader than anything the app needs (authenticated holds
-- SELECT/INSERT/UPDATE/DELETE), so an authenticated client could write rows into
-- a table nothing reads. Inert today, unnecessary surface tomorrow.
--
-- The table is NOT dropped — I did not create it and cannot see whether something
-- external uses it — so this closes the write surface and leaves the read path
-- intact for anything that might still depend on it. The existence check makes
-- the file a no-op on a fresh install, which does not have the table at all.

do $$
begin
  if to_regclass('public.follows') is not null then
    -- MAINTAIN is PG17 (the server runs 17.6); listing it explicitly keeps the
    -- revoke complete as privileges are added in later versions.
    revoke insert, update, delete, truncate, references, trigger, maintain
      on public.follows from anon, authenticated;
    -- keep SELECT for authenticated only if the policies already allowed it, so
    -- nothing that reads it today breaks
    grant select on public.follows to authenticated;
    revoke select on public.follows from anon;
  end if;
end $$;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'An orphan table carried a wider write grant than anything needs',
  'Production has public.follows — RLS enabled, four policies, zero rows — that no migration creates and no code references, the same provenance class as the orphan RPCs closed earlier. Its grants let an authenticated client insert, update and delete rows in a table nothing reads. The table is not dropped, because its provenance is unknown; its write grants are revoked and anon loses SELECT, while authenticated keeps the read path its policies already allowed. A fresh install does not have the table, so the guard makes this a no-op there.',
  '{"version": "follows-surface-1.0"}'::jsonb
);

notify pgrst, 'reload schema';