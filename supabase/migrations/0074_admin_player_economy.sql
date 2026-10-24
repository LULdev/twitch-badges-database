-- 0074 — stats_admin_player_economy: the ACP's member-economy overview.
--
-- Top 20 members by lifetime coins wagered with the full economy column set
-- (won/lost/wagered, rounds, wins, win rate, wheel spins, jackpot wins) — the
-- table that makes farming and bot patterns visible at a glance. The FIRST
-- service-role-only view in the stats_* family: per-user rows are fine for
-- admins (user_progress and jackpot_wins are row-by-row public-read anyway,
-- 0055's argument), but a ready-made ranking surface belongs behind the
-- panel, not on the anon key. No anon/authenticated grant.

create or replace view public.stats_admin_player_economy
with (security_invoker = off) as
select
  p.id as user_id,
  p.username,
  p.avatar_url,
  pr.coins_wagered::bigint as coins_wagered,
  pr.coins_won::bigint as coins_won,
  pr.coins_lost::bigint as coins_lost,
  (pr.coins_won - pr.coins_lost)::bigint as coins_net,
  pr.games_played::bigint as rounds_played,
  pr.games_won::bigint as rounds_won,
  case when pr.games_played > 0
    then round(pr.games_won::numeric / pr.games_played * 100, 1)
    else 0
  end as win_rate,
  pr.wheel_spins::bigint as wheel_spins,
  coalesce(j.jackpot_wins, 0)::bigint as jackpot_wins,
  pr.updated_at
from public.user_progress pr
join public.profiles p on p.id = pr.user_id
left join lateral (
  select count(*) as jackpot_wins
  from public.jackpot_wins jw
  where jw.user_id = pr.user_id
) j on true
where pr.coins_wagered > 0
order by pr.coins_wagered desc
limit 20;

comment on view public.stats_admin_player_economy is
  'ACP-only member-economy Top 20 (0074): per-user rows behind the admin gate — deliberately NOT granted to anon/authenticated.';

-- Supabase's default privileges auto-grant SELECT on new views in public to
-- anon+authenticated; this view must NOT inherit them — revoke explicitly
-- (the 0032 table pattern, applied to a view).
revoke select on public.stats_admin_player_economy from anon, authenticated;
grant select on public.stats_admin_player_economy to service_role;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Admin member-economy overview view',
  'stats_admin_player_economy ranks the 20 highest-turnover members with won/lost/wagered coins, rounds, win rate, wheel spins and jackpot wins — the first service-role-only stats view (no anon grant), read by the ACP stats tab to surface farming and bot patterns.',
  '{"version": "0074-1.0", "view": "stats_admin_player_economy", "grants": ["service_role"]}'::jsonb
);

notify pgrst, 'reload schema';
