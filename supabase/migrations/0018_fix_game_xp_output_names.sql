-- 0017 declared its OUT columns as `xp` and `coins`, which collide with the
-- same-named columns of `user_progress` inside the function body — every call
-- failed with SQLSTATE 42702 (ambiguous column reference), so the whole path was
-- broken rather than improved. The OUT names are now `out_xp`/`out_coins`.
--
-- (The UPDATE's SET target cannot be table-qualified in Postgres, so renaming the
-- outputs is the fix, not qualifying them.)

-- `create or replace` cannot change a function's OUT parameter names, so the old
-- signature has to go first. Dropping it is safe: it was broken from the moment
-- it was created (every call raised 42702), so nothing could depend on it.
drop function if exists public.consume_and_apply_game_xp(uuid, date, int, bigint);

create or replace function public.consume_and_apply_game_xp(
  p_user_id uuid,
  p_today date,
  p_requested int,
  p_coins bigint
)
returns table (out_xp bigint, out_coins bigint, granted int)
language plpgsql
as $$
declare
  spent int;
  allowed int;
begin
  if p_requested is null or p_requested <= 0 then
    return query
      update public.user_progress
         set coins = greatest(0, user_progress.coins + coalesce(p_coins, 0)),
             updated_at = now()
       where user_progress.user_id = p_user_id
      returning user_progress.xp, user_progress.coins, 0;
    return;
  end if;

  select case when up.game_xp_day = p_today then up.game_xp_today else 0 end
    into spent
    from public.user_progress up
   where up.user_id = p_user_id
     for update;

  if spent is null then
    return;
  end if;

  allowed := greatest(0, least(p_requested, 100 - spent));

  return query
    update public.user_progress
       set game_xp_day = p_today,
           game_xp_today = spent + allowed,
           xp = greatest(0, user_progress.xp + allowed),
           coins = greatest(0, user_progress.coins + coalesce(p_coins, 0)),
           updated_at = now()
     where user_progress.user_id = p_user_id
    returning user_progress.xp, user_progress.coins, allowed;
end;
$$;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Game XP award: ambiguous column names made the new function unusable',
  'The function added a moment earlier declared its output columns as xp and coins, which collide with the same-named user_progress columns inside the body: every call failed with SQLSTATE 42702 instead of committing the cap and the award together. The outputs are renamed out_xp/out_coins; the UPDATE target cannot be table-qualified in Postgres, so renaming is the fix.',
  '{"version": "game-xp-atomic-1.1"}'::jsonb
);

notify pgrst, 'reload schema';