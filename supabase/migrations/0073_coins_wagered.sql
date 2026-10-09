-- 0073 — coins_wagered: lifetime total of every coin ever STAKED in a
-- settled round (turnover), the third member of the won/lost/wagered trio the
-- profile's new arcade-statistics grid shows. coins_won / coins_lost already
-- carry the signed halves (per-round nets, split by sign, since 0003), but
-- the gross stake volume existed nowhere per-user.
--
-- Maintained exactly like the other two: bump_counters carries one more
-- delta line (the function's expressions are hardcoded, so it is recreated
-- here with the addition), games.ts passes `coins_wagered: bet` on every
-- settled non-refund round, and a CHECK keeps it non-negative (0032 style).
-- The one-time backfill below reconciles history from game_rounds.

alter table public.user_progress
  add column if not exists coins_wagered bigint not null default 0;

alter table public.user_progress
  add constraint user_progress_wagered_nonneg check (coins_wagered >= 0)
  not valid;

alter table public.user_progress
  validate constraint user_progress_wagered_nonneg;

-- Reconcile history: every settled round's stake, refunds excluded (a refund
-- round's bet was returned, so it never became turnover — the same cut
-- games.ts applies to the counters).
update public.user_progress up
   set coins_wagered = coalesce((
         select sum(gr.bet)
           from public.game_rounds gr
          where gr.user_id = up.user_id
            and coalesce((gr.result->>'refund')::boolean, false) is distinct from true
       ), 0);

create or replace function public.bump_counters(p_user_id uuid, p_deltas jsonb)
returns void
language sql
as $$
  update public.user_progress
     set games_played        = games_played        + coalesce((p_deltas->>'games_played')::int, 0),
         games_won           = games_won           + coalesce((p_deltas->>'games_won')::int, 0),
         coins_won           = coins_won           + coalesce((p_deltas->>'coins_won')::bigint, 0),
         coins_lost          = coins_lost          + coalesce((p_deltas->>'coins_lost')::bigint, 0),
         coins_wagered       = coins_wagered       + coalesce((p_deltas->>'coins_wagered')::bigint, 0),
         wheel_spins         = wheel_spins         + coalesce((p_deltas->>'wheel_spins')::int, 0),
         steals_successful   = steals_successful   + coalesce((p_deltas->>'steals_successful')::int, 0),
         steals_failed       = steals_failed       + coalesce((p_deltas->>'steals_failed')::int, 0),
         times_robbed        = times_robbed        + coalesce((p_deltas->>'times_robbed')::int, 0),
         achievements_points = achievements_points + coalesce((p_deltas->>'achievements_points')::int, 0),
         updated_at = now()
   where user_id = p_user_id;
$$;

revoke all on function public.bump_counters(uuid, jsonb) from anon, authenticated, public;
grant execute on function public.bump_counters(uuid, jsonb) to service_role;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Lifetime coins wagered per player',
  'user_progress gains a coins_wagered counter (lifetime stake volume of every settled non-refund round), maintained by bump_counters alongside coins_won/coins_lost and backfilled from game_rounds. It feeds the profile''s new arcade-statistics grid, where every statistic is individually hideable through the profile customization (default visible).',
  '{"version": "0073-1.0", "column": "coins_wagered", "backfill": "sum(bet) over settled non-refund rounds"}'::jsonb
);

notify pgrst, 'reload schema';
