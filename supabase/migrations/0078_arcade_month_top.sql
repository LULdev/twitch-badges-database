-- 0078 — Hall of the month: the trailing-30-day top 3 by settled rounds,
-- the community banner's "we together" line given faces. Per-user public
-- surface follows the 0004 stats_top_players / 0054 doctrine: username +
-- avatar_url only (both already anon-readable on profiles), aggregates over
-- game_rounds (public-read). security_invoker = off so the aggregate is
-- complete; the explicit grant mirrors 0072/0076 house style (Supabase
-- default privileges would grant anon anyway — this documents intent).
-- Un-materialized read-time window like stats_arcade_month (0076): the
-- lifetime stats_games view already scans strictly more rows per /stats load.

create or replace view public.stats_arcade_month_top
with (security_invoker = off) as
select
  p.username,
  p.avatar_url,
  count(*)::bigint as rounds_30d,
  coalesce(sum(r.bet), 0)::bigint as wagered_30d
from public.game_rounds r
join public.profiles p on p.id = r.user_id
where r.created_at >= now() - interval '30 days'
group by p.username, p.avatar_url
order by rounds_30d desc, wagered_30d desc, p.username
limit 3;

grant select on public.stats_arcade_month_top to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Hall of the month view',
  'stats_arcade_month_top exposes the trailing-30-day top 3 by settled rounds (username, avatar_url, rounds, wagered) for the games hub podium — public per-user surface per the 0004/0054 doctrine, aggregates over public-read game_rounds.',
  '{"version": "0078-1.0", "view": "stats_arcade_month_top", "top": 3, "window": "30d rolling"}'::jsonb
);

notify pgrst, 'reload schema';
