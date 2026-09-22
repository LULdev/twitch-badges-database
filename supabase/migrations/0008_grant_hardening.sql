-- ============================================================
-- 0008 — close the economy RPCs to API roles + grant hardening
-- ============================================================
-- 0006/0007 revoked EXECUTE from PUBLIC only. Supabase grants EXECUTE to the
-- `anon` and `authenticated` roles explicitly, so both roles could still call
-- the economy functions through PostgREST's /rest/v1/rpc/<fn> endpoint. The
-- functions are the only place coins and XP move without going through the
-- application's checks, so they must be service-role only.

revoke all on function public.apply_xp_coins(uuid, bigint, bigint) from anon, authenticated;
revoke all on function public.add_coins(uuid, bigint) from anon, authenticated;
revoke all on function public.bump_view_count(uuid) from anon, authenticated;
revoke all on function public.bump_counters(uuid, jsonb) from anon, authenticated;
revoke all on function public.claim_daily_gate(uuid, date) from anon, authenticated;
revoke all on function public.claim_wheel_gate(uuid, date) from anon, authenticated;
revoke all on function public.consume_game_xp(uuid, date, int) from anon, authenticated;
revoke all on function public.protect_profile_columns() from anon, authenticated;

-- belt and braces: make the grant state explicit for the service role
grant execute on function public.apply_xp_coins(uuid, bigint, bigint) to service_role;
grant execute on function public.add_coins(uuid, bigint) to service_role;
grant execute on function public.bump_view_count(uuid) to service_role;
grant execute on function public.bump_counters(uuid, jsonb) to service_role;
grant execute on function public.claim_daily_gate(uuid, date) to service_role;
grant execute on function public.claim_wheel_gate(uuid, date) to service_role;
grant execute on function public.consume_game_xp(uuid, date, int) to service_role;

-- `blog_reactions` kept its INSERT grant for anonymous readers (by design) but
-- also its DELETE grant for `authenticated`, which the RLS policy already
-- scopes to the owner — make that explicit instead of relying on the policy.
revoke insert, update on public.blog_reactions from anon, authenticated;
grant insert on public.blog_reactions to anon, authenticated;

-- The app never inserts profiles itself (the auth trigger does it), so the
-- client-side insert policy is unnecessary surface.
drop policy if exists "profiles_self_insert" on public.profiles;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Security: economy RPCs restricted to the service role',
  'The atomic helpers introduced in 0006/0007 revoked EXECUTE from PUBLIC but not from the anon and authenticated roles, which Supabase grants explicitly — so /rest/v1/rpc/<function> stayed callable by any visitor. All seven functions (apply_xp_coins, add_coins, bump_view_count, bump_counters, claim_daily_gate, claim_wheel_gate, consume_game_xp) and the profile guard trigger function are now restricted to service_role, and the unused client-side profiles INSERT policy was dropped.',
  '{"version": "grants-1.0"}'::jsonb
);