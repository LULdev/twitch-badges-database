-- Daily game-activity streak: consecutive UTC days with at least one settled
-- game round. Separate from the daily-claim login streak by design —
-- achievements k_ghost / s_lazy_week reward logging in WITHOUT playing, so a
-- play streak must never touch login_streak. Counter + compare-and-set gate
-- (the claim_daily_gate doctrine): after the day's first round, later rounds
-- short-circuit at the predicate instead of re-reading history forever, and
-- the UTC-midnight straddle race is resolved by the same single UPDATE.

alter table public.user_progress
  add column if not exists game_streak int not null default 0,
  add column if not exists best_game_streak int not null default 0,
  add column if not exists game_streak_last date;

alter table public.user_progress
  add constraint user_progress_game_streak_non_negative
    check (game_streak >= 0 and best_game_streak >= 0);

-- Returns the new streak; -1 = "already advanced today" (sentinel, the
-- claim_daily_gate convention). The best_streak high-water is updated in the
-- SAME transaction, mirroring 0007's best_login_streak pattern.
create or replace function public.game_streak_gate(p_user_id uuid, p_today date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row user_progress;
begin
  select * into v_row from public.user_progress where user_id = p_user_id for update;
  if not found then
    return -1;
  end if;

  if v_row.game_streak_last is distinct from p_today then
    update public.user_progress
    set game_streak = case
          when v_row.game_streak_last = p_today - 1 then v_row.game_streak + 1
          else 1
        end,
        game_streak_last = p_today,
        best_game_streak = greatest(
          v_row.best_game_streak,
          case
            when v_row.game_streak_last = p_today - 1 then v_row.game_streak + 1
            else 1
          end
        ),
        updated_at = now()
    where user_id = p_user_id;

    return case
      when v_row.game_streak_last = p_today - 1 then v_row.game_streak + 1
      else 1
    end;
  end if;

  return -1;
end;
$$;

revoke all on all functions in schema public from anon, authenticated;
grant execute on function public.game_streak_gate(uuid, date) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Daily game-activity streak with bonus XP',
  'Playing at least one arcade round on consecutive UTC days now builds a game streak (columns on user_progress, advanced by a compare-and-set RPC on the day''s first settled round, high-water tracked as best_game_streak). The bonus XP is computed app-side from admin-editable economy settings with its own ceiling — deliberately outside the 100 XP daily game cap, mirroring the daily-claim streak bonus — and is awarded once per day straight after settlement. The play streak never touches login_streak: the Ghost Login and Lazy Week achievements reward logging in without playing and must stay honest.',
  '{"version": "game-streak-1.0", "rpc": "game_streak_gate"}'::jsonb
);
