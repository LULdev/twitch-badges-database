-- 0076 — stats_arcade_month: the community's rolling 30-day totals, computed
-- at read time (the stats_game_wins_week precedent — a rolling window over
-- game_rounds; the lifetime stats_games view already scans strictly more rows
-- on every /stats load, so an un-materialized window is fine at this scale).
-- One row, aggregates only — no per-user data — feeding the games hub's
-- "Community month" banner.

create or replace view public.stats_arcade_month
with (security_invoker = off) as
select
  count(*)::bigint as rounds_30d,
  coalesce(sum(bet), 0)::bigint as wagered_30d,
  coalesce(sum(payout - bet), 0)::bigint as net_30d,
  count(*) filter (where won)::bigint as won_rounds_30d,
  count(distinct user_id)::bigint as players_30d
from public.game_rounds
where created_at >= now() - interval '30 days';

grant select on public.stats_arcade_month to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Community month totals view',
  'stats_arcade_month exposes the rolling 30-day arcade totals — rounds, coins wagered, net, won rounds and active players — as one public aggregate row for the games hub''s community banner. Aggregates only, no per-user data, computed at read time like the other rolling views.',
  '{"version": "0076-1.0", "view": "stats_arcade_month"}'::jsonb
);

notify pgrst, 'reload schema';
