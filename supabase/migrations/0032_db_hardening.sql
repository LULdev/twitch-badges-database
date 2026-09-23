-- ============================================================
-- Database hardening from the full-project hunt.
--
-- Four independent problems, all of the same family: a privilege or a policy
-- that is broader than anything the application uses.
-- ============================================================

-- 1) `revoke … from anon, authenticated` does NOT remove a default grant made to
--    PUBLIC. Both functions below still carry `=X/postgres` in their ACL, which
--    is EXECUTE for every role.
--
--    `acp_gate_attempt` is the serious one: it is SECURITY DEFINER, it writes
--    `site_settings`, and it takes the window and the caller key as parameters —
--    so anyone holding the publishable key could call
--    /rest/v1/rpc/acp_gate_attempt with a fresh p_ip to reset the bootstrap
--    brute-force counter and guess the passcode without limit. That door is open
--    right now: no owner is registered.
--
--    The revoke has to name PUBLIC.
revoke all on function public.acp_gate_attempt(text, bigint, int, int) from public;
revoke all on function public.acp_gate_attempt(text, bigint, int, int) from anon, authenticated;
revoke all on function public.vote_idea(bigint, int) from public;
revoke all on function public.vote_idea(bigint, int) from anon, authenticated;
-- Not exploitable (a trigger function raises when called directly, and neither is
-- SECURITY DEFINER), but the same ineffective revoke was meant to exist.
revoke all on function public.sync_is_admin() from public, anon, authenticated;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;

-- 2) `profile_visits` kept a table-level SELECT grant for `authenticated`, so a
--    profile owner could read the rows of everyone who looked at them —
--    including `ip_hash`, which is a hash under a single app-wide salt and is
--    therefore comparable across the whole site: enough to tell that the same
--    visitor browsed two different profiles.
--
--    The app never reads this table as the member: the profile page uses the
--    service role (it says so in a comment, because reading it per visitor
--    published who had looked at whom). The owner-read policy stays as the
--    second layer it was written to be.
revoke select on public.profile_visits from authenticated;
revoke select on public.profile_visits from anon;

-- 3) `user_inventory` had an INSERT policy with no check at all, and
--    `authenticated` held table-level INSERT — so a member could forge their own
--    badge ownership directly against the REST API. The sync is the only writer
--    (src/lib/inventory.ts, with the service role) and no code path used the
--    policy, so it goes.
drop policy if exists "inventory_self_insert" on public.user_inventory;
revoke insert on public.user_inventory from authenticated, anon;

-- 4) The oldest tables (0001/0003/0004) still carried the default grants that
--    migration 0023 stripped from the newer ones: TRUNCATE, REFERENCES, TRIGGER
--    and MAINTAIN for anon and authenticated. TRUNCATE is the dangerous one —
--    it is NOT subject to row-level security, so the grant is a table-wipe
--    permission; PostgREST exposing no truncate verb is the only reason it was
--    unreachable. MAINTAIN exists as a privilege on PostgreSQL 17, which this
--    project runs.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;

-- 5) `user_progress` invariants on the counters.
--
--    `coins`, `xp`, `level` and the streak columns already carry CHECKs from an
--    earlier migration. The counters added later do not — and `bump_counters`
--    applies deltas without clamping, so nothing but the application's own care
--    has kept `coins_won`, `wheel_spins` and the rest sane. (The hunt's claim was
--    that the table had no CHECKs at all; that was wrong about these four, which
--    is exactly why each one is written idempotently below rather than assumed.)
--
--    Verified against the live data first: one row, zero violations on every
--    predicate, so these validate without a rewrite.
alter table public.user_progress
  drop constraint if exists user_progress_gamexp_non_negative,
  drop constraint if exists user_progress_points_non_negative,
  drop constraint if exists user_progress_games_sane,
  drop constraint if exists user_progress_coin_totals_non_negative,
  drop constraint if exists user_progress_counters_non_negative;

alter table public.user_progress
  add constraint user_progress_gamexp_non_negative check (game_xp_today >= 0),
  add constraint user_progress_points_non_negative check (achievements_points >= 0),
  add constraint user_progress_games_sane check (games_played >= 0 and games_won >= 0 and games_won <= games_played),
  add constraint user_progress_coin_totals_non_negative check (coins_won >= 0 and coins_lost >= 0),
  add constraint user_progress_counters_non_negative check (
    wheel_spins >= 0 and steals_successful >= 0 and steals_failed >= 0 and times_robbed >= 0
  );

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Database hardening: public EXECUTE on a SECURITY DEFINER function, visitor hashes readable by profile owners, forgeable inventory, and default grants on the oldest tables',
  'Four privileges that were broader than anything the application uses. The bootstrap throttle function was still executable by PUBLIC — a revoke naming only anon and authenticated does not remove a default grant made to PUBLIC — and because it is SECURITY DEFINER and takes the window and the caller key as parameters, anyone with the publishable key could call it with a fresh key to reset the counter and guess the passcode without limit, on an installation whose bootstrap door is still open. The visitor table kept a SELECT grant for authenticated, letting a profile owner read their visitors ip_hash values, which are hashed under one app-wide salt and therefore comparable across the whole site; the app reads that table with the service role, so the grant was pure exposure. The inventory table carried an INSERT policy with no check plus a table-level INSERT grant, so a member could forge their own badge ownership against the REST API even though the sync is the only writer. And the oldest tables still had the default TRUNCATE, REFERENCES, TRIGGER and MAINTAIN grants that an earlier migration had stripped from the newer ones — TRUNCATE is not subject to row-level security, so that grant was a table-wipe permission held back only by PostgREST not offering the verb. The counter invariants the application already clamps on every path it owns — non-negative game XP, achievement points, coins won and lost, games played and won, wheel spins, successful and failed steals and times robbed, and games won never exceeding games played — are now CHECK constraints on the table. Four other columns (coins, XP, level, streaks) already had CHECKs from an earlier migration; the hunt reported the table as having none, which is why each constraint is written idempotently and was verified against the live data before being added.',
  '{"version": "db-hardening-1.0"}'::jsonb
);

notify pgrst, 'reload schema';