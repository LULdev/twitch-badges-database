-- Three findings from the replay round that concern privileges the earlier
-- migrations did not cover completely. Each is inert today (the two roles are
-- NOLOGIN and PostgREST exposes neither TRUNCATE nor MAINTAIN) — they are closed
-- because a grant with no purpose is surface, not because anything was reachable.
--
-- v27-01: 0021 kept the signature-specific `to_regprocedure` guard that 0020 was
--   fixed for. It fails OPEN: a changed signature returns null and the revoke is
--   skipped. This applies the overload-robust revoke to production (0021's own
--   file is fixed for fresh installs).
-- v27-02: 0022's revoke list omitted MAINTAIN, which exists on PG17 (the server
--   runs 17.6).
-- v27-03: 0011 revoked only SELECT on blog_views/blog_reactions, leaving
--   TRUNCATE, REFERENCES, TRIGGER and MAINTAIN granted.

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

  if to_regclass('public.blog_views') is not null then
    execute 'revoke all on public.blog_views from anon, authenticated';
    execute 'grant select (post_id, created_at) on public.blog_views to anon, authenticated';
  end if;

  if to_regclass('public.blog_reactions') is not null then
    execute 'revoke all on public.blog_reactions from anon, authenticated';
    execute 'grant insert on public.blog_reactions to anon, authenticated';
    execute 'grant select (post_id, emoji, created_at) on public.blog_reactions to anon, authenticated';
  end if;

  if to_regclass('public.follows') is not null then
    execute 'revoke insert, update, delete, truncate, references, trigger, maintain on public.follows from anon, authenticated';
    execute 'grant select on public.follows to authenticated';
    execute 'revoke select on public.follows from anon';
  end if;
end $$;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Table privileges closed completely, and the profile guard revoked by overload',
  'Three gaps the replay round found: 0021 still used the signature-specific guard that fails open (a changed signature would have skipped the revoke), 0022 omitted MAINTAIN which exists on PG17, and 0011 revoked only SELECT on blog_views/blog_reactions while TRUNCATE, REFERENCES, TRIGGER and MAINTAIN stayed granted. None of it was reachable — both roles are NOLOGIN and PostgREST exposes neither privilege — but a grant with no purpose is surface. The two blog tables keep exactly the column-level access the pages use.',
  '{"version": "privilege-surface-1.0"}'::jsonb
);

notify pgrst, 'reload schema';