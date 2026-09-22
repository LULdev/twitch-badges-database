-- The verification pass listed every function anon/authenticated can execute and
-- found five that no migration creates and no code calls:
--
--   latest_badge_stats(int)     anon + authenticated   orphan (read RPC)
--   get_own_profile_email()     authenticated          orphan (read RPC)
--   handle_new_user()           PUBLIC (default)       trigger function
--   touch_updated_at()          PUBLIC (default)       trigger function
--   touch_badges_updated_at()   PUBLIC (default)       trigger function
--
-- The two read RPCs are leftovers from an earlier prototype: nothing in the repo
-- references them and no migration creates them, so a fresh install does not have
-- them — a divergence between production and the migrations worth noting on its
-- own. They are NOT dropped here: I did not create them and cannot see whether an
-- external client uses them, so this closes their exposure and surfaces the
-- divergence instead of deleting an object of unknown provenance.
--
-- The three trigger functions only run as triggers, so a direct call fails with
-- 0A000 and the default PUBLIC grant was never exploitable — revoking it is
-- defence in depth and removes them from the reachable surface. Revoking EXECUTE
-- does not affect the triggers themselves, which run as the table owner.

-- v25-01: the two orphan RPCs exist in THIS database but no migration creates
-- them, so an unconditional REVOKE aborts on a fresh install with 42883
-- ("function does not exist") and blocks every later migration — the documented
-- `npm run db:apply` path would never complete. Each revoke is therefore guarded
-- by a existence check, which is a no-op on a fresh database.
-- v26-02: the first version guarded each revoke with
-- `to_regprocedure('public.name(args)')`, which is signature-specific and fails
-- OPEN — if a signature ever changed, the guard returned null and the revoke was
-- silently skipped. This loops over every overload of each named function and
-- revokes them all, so a signature change cannot quietly leave one exposed.
do $$
declare
  target text;
  sig record;
begin
  foreach target in array array[
    'latest_badge_stats',
    'get_own_profile_email',
    'handle_new_user',
    'touch_updated_at',
    'touch_badges_updated_at',
    'protect_profile_columns'
  ]
  loop
    for sig in
      select p.oid::regprocedure as s
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = target
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated', sig.s
      );
      execute format('grant execute on function %s to service_role', sig.s);
    end loop;
  end loop;
end $$;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Public function surface closed: two orphan RPCs and three trigger functions',
  'A sweep of every function anon/authenticated can execute found two read RPCs that no migration creates and no code calls (latest_badge_stats, get_own_profile_email) and three trigger functions carrying the default PUBLIC grant. The read RPCs are leftovers from an earlier prototype; they are not dropped because their provenance is unknown, but their public grants are revoked and the production/migration divergence is recorded. The trigger functions only run as triggers (a direct call fails with 0A000), so revoking their PUBLIC grant is defence in depth.',
  '{"version": "function-surface-1.0"}'::jsonb
);

notify pgrst, 'reload schema';