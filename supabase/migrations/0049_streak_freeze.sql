-- Streak Freeze: the first inventory item. A freeze bridges ONE missed day —
-- the game streak neither resets nor grows on the bridged day. Users start
-- with 2 (granted exactly-once via a compare-and-set flag, not hooked to the
-- OAuth callback: returning users with persistent sessions never see it),
-- and earn +1 whenever best_game_streak crosses a multiple of 7.

create table if not exists public.user_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_key text not null,
  quantity int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key),
  constraint user_items_quantity_non_negative check (quantity >= 0)
);

alter table public.user_items enable row level security;
-- No policies on purpose (the badge_unlock_rewards doctrine): the item RPC is
-- security definer, every write flows through service code, and the public
-- profile reads the count through the service-role client exactly like
-- user_achievements. A future self-serve path would add scoped policies then.

alter table public.user_progress
  add column if not exists starter_freezes_granted boolean not null default false;

-- Exactly-once starter grant: the predicate IS the guarantee — of two
-- concurrent callers exactly one UPDATE matches (the claim_daily_gate
-- doctrine). Callers can invoke it on every authenticated touchpoint.
create or replace function public.grant_starter_items(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.user_progress
     set starter_freezes_granted = true,
         updated_at = now()
   where user_id = p_user_id
     and starter_freezes_granted = false
   returning 1 into v_rows;

  if v_rows is null then
    return 0;  -- already granted (or no progress row yet — callers ensure it)
  end if;

  insert into public.user_items as ui (user_id, item_key, quantity)
  values (p_user_id, 'streak_freeze', 2)
  on conflict (user_id, item_key)
  do update set quantity = ui.quantity + 2, updated_at = now();

  return 2;
end;
$$;

revoke all on all functions in schema public from anon, authenticated;
grant execute on function public.grant_starter_items(uuid) to service_role;

-- Gate rewrite: composite return (streak, freeze_used, freeze_earned); the gap
-- case consumes one freeze and preserves the streak value (game_streak_last
-- still lands on today, so one freeze per day is structurally capped); the
-- earn fires inside the same transaction when the best crosses a multiple of 7.
-- DROP first: `create or replace` cannot change the return type (int → table).
drop function if exists public.game_streak_gate(uuid, date);

create function public.game_streak_gate(p_user_id uuid, p_today date)
returns table (streak int, freeze_used boolean, freeze_earned boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      user_progress;
  v_new      int;
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
      -- GAP bridged: one freeze burned, the streak value survives untouched.
      update public.user_items
         set quantity = quantity - 1, updated_at = now()
       where user_id = p_user_id and item_key = 'streak_freeze';
      v_new := v_row.game_streak;
      v_freeze := true;
    else
      v_new := 1;  -- missed day, no freeze (or no streak yet)
    end if;

    update public.user_progress
       set game_streak = v_new,
           game_streak_last = p_today,
           best_game_streak = greatest(v_row.best_game_streak, v_new),
           updated_at = now()
     where user_id = p_user_id
     returning best_game_streak into v_new;

    -- A streak grows by at most one per day (zero on a freeze day), so the
    -- best can cross exactly one multiple of 7 per call: one earn is exact.
    if v_new > v_old_best and v_new % 7 = 0 then
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

revoke all on all functions in schema public from anon, authenticated;
grant execute on function public.game_streak_gate(uuid, date) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Streak Freeze: the first inventory item',
  'Every Twitch-connected member starts with two Streak Freezes, granted exactly once through a compare-and-set flag rather than the OAuth callback so returning sessions are covered too. The game-streak gate now burns one freeze when a day is missed — the streak value survives untouched, neither reset nor grown — and earns a new freeze whenever the best streak crosses a multiple of seven, all inside the same locked transaction. Freezes live in the new user_items table keyed (user_id, item_key), service-role-write only, ready for future items.',
  '{"version": "streak-freeze-1.0", "starter": 2, "earnEveryDays": 7, "rpcs": ["grant_starter_items", "game_streak_gate"]}'::jsonb
);
