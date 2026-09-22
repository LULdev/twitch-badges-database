-- gam-7 residual: the daily game-XP cap was consumed in one statement and the XP
-- granted in another, so a hard failure between them burned that much of the
-- day's 100-XP budget without granting anything. The ordering had to stay
-- "reserve, then apply" because that is the only way the cap holds under
-- concurrency — but reserving and applying can be ONE statement.
--
-- `consume_and_apply_game_xp` takes the same row lock as `consume_game_xp`
-- (SELECT … FOR UPDATE), clamps the grant to the remaining budget, and applies
-- the XP and the coins in the same UPDATE. Either everything lands or nothing
-- does, so a failure can no longer cost the player budget.
--
-- `consume_game_xp` and `apply_xp_coins` stay for the paths that do not count
-- against the cap.

create or replace function public.consume_and_apply_game_xp(
  p_user_id uuid,
  p_today date,
  p_requested int,
  p_coins bigint
)
returns table (xp bigint, coins bigint, granted int)
language plpgsql
as $$
declare
  spent int;
  allowed int;
begin
  if p_requested is null or p_requested <= 0 then
    -- Nothing to consume, but the coins still move.
    return query
      update public.user_progress
         set coins = greatest(0, coins + coalesce(p_coins, 0)),
             updated_at = now()
       where user_id = p_user_id
      returning user_progress.xp, user_progress.coins, 0;
    return;
  end if;

  select case when game_xp_day = p_today then game_xp_today else 0 end
    into spent
    from public.user_progress
   where user_id = p_user_id
     for update;

  -- No progress row: nothing to award, same contract as consume_game_xp.
  if spent is null then
    return;
  end if;

  allowed := greatest(0, least(p_requested, 100 - spent));

  return query
    update public.user_progress
       set game_xp_day = p_today,
           game_xp_today = spent + allowed,
           xp = greatest(0, xp + allowed),
           coins = greatest(0, coins + coalesce(p_coins, 0)),
           updated_at = now()
     where user_id = p_user_id
    returning user_progress.xp, user_progress.coins, allowed;
end;
$$;

revoke all on function public.consume_and_apply_game_xp(uuid, date, int, bigint) from public;
revoke all on function public.consume_and_apply_game_xp(uuid, date, int, bigint) from anon, authenticated;
grant execute on function public.consume_and_apply_game_xp(uuid, date, int, bigint) to service_role;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Game XP: the daily cap and the award now commit together',
  'The 100 XP/day game cap was consumed under a row lock and the XP granted in a second statement, so a hard failure in between spent part of the day''s budget without granting anything. consume_and_apply_game_xp takes the same lock and performs the clamp, the budget bookkeeping and the XP and coin increments in one UPDATE, so a failure can no longer cost a player budget. The reservation still happens before the grant, which is what makes the cap hold under concurrency.',
  '{"version": "game-xp-atomic-1.0"}'::jsonb
);

notify pgrst, 'reload schema';