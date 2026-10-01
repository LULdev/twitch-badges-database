-- Bugfix for the 0049 gate rewrite: `returning best_game_streak into v_new`
-- CLOBBERED the freshly computed streak with the best-streak value, so the
-- gate returned the best instead of the streak (a round on day 4 of a
-- streak reported 9 when the best was 9) and the earn rule compared the
-- best against itself (never >, so freezes were never earned). The streak
-- COLUMN was written correctly throughout — only the return and the earn
-- check read the wrong variable. Fix: keep them apart.

create or replace function public.game_streak_gate(p_user_id uuid, p_today date)
returns table (streak int, freeze_used boolean, freeze_earned boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      user_progress;
  v_new      int;
  v_best     int;
  v_old_best int;
  v_freeze   boolean := false;
  v_earned   boolean := false;
begin
  select * into v_row from public.user_progress where user_id = p_user_id for update;
  if not found then
    return query select -1, false, false;
    return;
  end if;
  v_old_best := v_row.best_game_streak;

  if v_row.game_streak_last is distinct from p_today then
    if v_row.game_streak_last = p_today - 1 then
      v_new := v_row.game_streak + 1;
    elsif v_row.game_streak_last < p_today - 1
          and v_row.game_streak > 0
          and coalesce((
            select quantity from public.user_items
             where user_id = p_user_id and item_key = 'streak_freeze'
          ), 0) > 0 then
      update public.user_items
         set quantity = quantity - 1, updated_at = now()
       where user_id = p_user_id and item_key = 'streak_freeze';
      v_new := v_row.game_streak;
      v_freeze := true;
    else
      v_new := 1;
    end if;

    update public.user_progress
       set game_streak = v_new,
           game_streak_last = p_today,
           best_game_streak = greatest(v_row.best_game_streak, v_new),
           updated_at = now()
     where user_id = p_user_id
     returning best_game_streak into v_best;

    -- The earn compares the NEW best against the OLD one (v_best > v_old_best)
    -- — comparing v_new against v_old_best is also correct for the streak
    -- value, but the returned streak must be v_new either way.
    if v_best > v_old_best and v_best % 7 = 0 then
      insert into public.user_items as ui (user_id, item_key, quantity)
      values (p_user_id, 'streak_freeze', 1)
      on conflict (user_id, item_key)
      do update set quantity = ui.quantity + 1, updated_at = now();
      v_earned := true;
    end if;

    return query select v_new, v_freeze, v_earned;
  end if;

  return query select -1, false, false;
end;
$$;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Game-streak gate returned the best streak instead of the streak',
  'The 0049 rewrite reused v_new for both the freshly computed streak and the RETURNING best_game_streak value, so the gate reported the best instead of the streak — the earn rule then compared the best against itself and never awarded freezes. The stored columns were always correct; only the return payload and the earn check read the wrong variable. Fixed with a dedicated v_best.',
  '{"risk": "medium", "version": "gate-return-fix-1.0"}'::jsonb
);
