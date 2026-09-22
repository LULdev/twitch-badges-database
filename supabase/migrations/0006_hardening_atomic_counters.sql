-- ============================================================
-- 0006 — security hardening + atomic economy counters
-- ============================================================
-- Fixes three confirmed defects:
--
--  1. `profiles_self_update` (0001) has no column restriction, so any
--     authenticated user could PATCH protected columns straight through the
--     public REST API — including `is_admin` (privilege escalation),
--     `view_count` (public counter) and `twitch_id` (identity matching).
--  2. The coin/XP/view counters were written as read-modify-write
--     (SELECT then UPDATE with a computed absolute value), so concurrent
--     awards silently destroyed each other's increments.
--  3. `coinRain` accepted an arbitrary profile id and 500ed on the FK.

-- ------------------------------------------------------------
-- 1) Column protection for end-user writes
-- ------------------------------------------------------------
-- auth.uid() is NULL for the service role and for scripts/cron SQL, so only
-- requests carrying an end-user JWT are constrained. The trigger silently
-- restores the previous values, which keeps the attacker's request a 200 with
-- no effect instead of leaking which column was refused.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.id := old.id;
    new.is_admin := old.is_admin;
    new.view_count := old.view_count;
    new.twitch_id := old.twitch_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ------------------------------------------------------------
-- 2) Atomic counters (no lost updates under concurrency)
-- ------------------------------------------------------------
create or replace function public.bump_view_count(p_profile_id uuid)
returns void
language sql
as $$
  update public.profiles
     set view_count = view_count + 1
   where id = p_profile_id;
$$;

create or replace function public.add_coins(p_user_id uuid, p_amount bigint)
returns bigint
language sql
as $$
  update public.user_progress
     set coins = greatest(0, coins + p_amount),
         updated_at = now()
   where user_id = p_user_id
  returning coins;
$$;

create or replace function public.apply_xp_coins(
  p_user_id uuid,
  p_xp bigint,
  p_coins bigint
)
returns table (xp bigint, coins bigint)
language sql
as $$
  update public.user_progress
     set xp = greatest(0, xp + p_xp),
         coins = greatest(0, coins + p_coins),
         updated_at = now()
   where user_id = p_user_id
  returning xp, coins;
$$;

-- Default grants give EXECUTE to PUBLIC; take that away and hand the
-- functions to the service role only (cron routes, scripts, server code).
revoke all on function public.bump_view_count(uuid) from public;
revoke all on function public.add_coins(uuid, bigint) from public;
revoke all on function public.apply_xp_coins(uuid, bigint, bigint) from public;
grant execute on function public.bump_view_count(uuid) to service_role;
grant execute on function public.add_coins(uuid, bigint) to service_role;
grant execute on function public.apply_xp_coins(uuid, bigint, bigint) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Security hardening: profile column protection + atomic economy counters',
  'The profiles UPDATE policy allowed any logged-in user to write protected columns (is_admin, view_count, twitch_id) directly through the public REST API, bypassing the /api/account whitelist; a BEFORE UPDATE trigger now restores those columns for every non-service-role write. Coin, XP and view counters were written as read-modify-write and lost increments whenever two awards overlapped — they now go through atomic SQL increments (add_coins, apply_xp_coins, bump_view_count), which also removes the 500 that coinRain produced for unknown profile ids.',
  '{"version": "hardening-1.0"}'::jsonb
);