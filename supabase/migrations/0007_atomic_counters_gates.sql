-- ============================================================
-- 0007 — atomic counters and race-free daily gates
-- ============================================================
-- Completes the fix started in 0006. Two classes of defect remain there:
--
--  1. The per-user COUNTER columns (games_played, games_won, coins_won,
--     coins_lost, wheel_spins, steals_successful, steals_failed,
--     times_robbed, achievements_points) are still written as
--     read-modify-write, so two overlapping writes lose one increment.
--  2. The once-per-day gates (daily bonus, wheel, game-XP cap) check a value
--     and then write it in separate statements. Two parallel requests both
--     pass the check and both get the reward — the gate is not atomic.
--
-- Every function here is EXECUTE-restricted to the service role, matching 0006.

-- ------------------------------------------------------------
-- 1) Counter deltas in one statement
-- ------------------------------------------------------------
-- p_deltas is a jsonb object of column → integer delta; unknown keys are
-- ignored, so a caller can bump one counter without touching the rest.
create or replace function public.bump_counters(p_user_id uuid, p_deltas jsonb)
returns void
language sql
as $$
  update public.user_progress
     set games_played        = games_played        + coalesce((p_deltas->>'games_played')::int, 0),
         games_won           = games_won           + coalesce((p_deltas->>'games_won')::int, 0),
         coins_won           = coins_won           + coalesce((p_deltas->>'coins_won')::bigint, 0),
         coins_lost          = coins_lost          + coalesce((p_deltas->>'coins_lost')::bigint, 0),
         wheel_spins         = wheel_spins         + coalesce((p_deltas->>'wheel_spins')::int, 0),
         steals_successful   = steals_successful   + coalesce((p_deltas->>'steals_successful')::int, 0),
         steals_failed       = steals_failed       + coalesce((p_deltas->>'steals_failed')::int, 0),
         times_robbed        = times_robbed        + coalesce((p_deltas->>'times_robbed')::int, 0),
         achievements_points = achievements_points + coalesce((p_deltas->>'achievements_points')::int, 0),
         updated_at = now()
   where user_id = p_user_id;
$$;

-- ------------------------------------------------------------
-- 2) Daily login gate — compare-and-set, returns the new streak
-- ------------------------------------------------------------
-- Returns -1 when today's bonus was already taken, otherwise the new streak
-- length. The `last_login_date is distinct from p_today` predicate is what
-- makes it atomic: of two concurrent callers exactly one updates a row and
-- therefore exactly one receives a non-negative result.
create or replace function public.claim_daily_gate(p_user_id uuid, p_today date)
returns int
language plpgsql
as $$
declare
  claimed int;
  new_streak int;
begin
  update public.user_progress
     set login_streak = case
           when last_login_date = p_today - 1 then login_streak + 1
           else 1
         end,
         last_login_date = p_today,
         updated_at = now()
   where user_id = p_user_id
     and last_login_date is distinct from p_today;

  get diagnostics claimed = row_count;
  if claimed = 0 then
    return -1;
  end if;

  update public.user_progress
     set best_login_streak = greatest(best_login_streak, login_streak)
   where user_id = p_user_id
  returning login_streak into new_streak;

  return new_streak;
end;
$$;

-- ------------------------------------------------------------
-- 3) Wheel gate — same compare-and-set, bumps the spin counter
-- ------------------------------------------------------------
create or replace function public.claim_wheel_gate(p_user_id uuid, p_today date)
returns boolean
language plpgsql
as $$
declare
  claimed int;
begin
  update public.user_progress
     set last_wheel_date = p_today,
         wheel_spins = wheel_spins + 1,
         updated_at = now()
   where user_id = p_user_id
     and last_wheel_date is distinct from p_today;

  get diagnostics claimed = row_count;
  return claimed > 0;
end;
$$;

-- ------------------------------------------------------------
-- 4) Daily game-XP cap — serialised per user
-- ------------------------------------------------------------
-- `select … for update` locks the row, so the cap cannot be overshot by
-- parallel rounds. Returns the XP actually granted (0 once the 100 XP budget
-- for the day is used up).
create or replace function public.consume_game_xp(
  p_user_id uuid,
  p_today date,
  p_requested int
)
returns int
language plpgsql
as $$
declare
  spent int;
  allowed int;
begin
  if p_requested is null or p_requested <= 0 then
    return 0;
  end if;

  select case when game_xp_day = p_today then game_xp_today else 0 end
    into spent
    from public.user_progress
   where user_id = p_user_id
     for update;

  if spent is null then
    return 0;
  end if;

  allowed := greatest(0, least(p_requested, 100 - spent));

  update public.user_progress
     set game_xp_day = p_today,
         game_xp_today = spent + allowed,
         updated_at = now()
   where user_id = p_user_id;

  return allowed;
end;
$$;

-- ------------------------------------------------------------
-- Grants: service role only (same contract as 0006)
-- ------------------------------------------------------------
revoke all on function public.bump_counters(uuid, jsonb) from public;
revoke all on function public.claim_daily_gate(uuid, date) from public;
revoke all on function public.claim_wheel_gate(uuid, date) from public;
revoke all on function public.consume_game_xp(uuid, date, int) from public;
grant execute on function public.bump_counters(uuid, jsonb) to service_role;
grant execute on function public.claim_daily_gate(uuid, date) to service_role;
grant execute on function public.claim_wheel_gate(uuid, date) to service_role;
grant execute on function public.consume_game_xp(uuid, date, int) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Economy: remaining counters atomic, daily gates race-free',
  'Completed the atomicity work from 0006. The per-user counter columns (games_played, games_won, coins_won, coins_lost, wheel_spins, steals_successful, steals_failed, times_robbed, achievements_points) were still written as read-modify-write and lost one increment whenever two writes overlapped; they now move through bump_counters(jsonb deltas) in a single statement. The daily login bonus, the wheel spin and the 100 XP/day game cap were check-then-write, so two parallel requests could both collect the reward — claim_daily_gate, claim_wheel_gate and consume_game_xp now use a compare-and-set predicate or a row lock, which makes exactly one caller win.',
  '{"version": "atomic-counters-2.0"}'::jsonb
);