-- Record-break leaderboard: the players whose personal best rose most often
-- over the last seven days. A record break is a round whose net beats every
-- round the SAME player settled before it — so the running-max window spans
-- the player's FULL history and the seven-day filter applies only AFTER the
-- breaks are identified (a window restricted to the week would crown every
-- player's first in-window round a spurious break). Aggregates only: the view
-- exposes username/avatar (already public) and per-user counts — no round
-- rows, no user_id (the join key stays internal), matching the stats_*
-- doctrine. Live plain view; game_rounds grows slowly and the window scan is
-- indexed by (user_id, created_at) from 0003/0009.

create or replace view public.stats_record_breaks_week
with (security_invoker = off) as
with nets as (
  select gr.id, gr.user_id, gr.created_at, gr.game, gr.payout - gr.bet as net
  from public.game_rounds gr
),
stepped as (
  select n.*,
         max(n.net) over (
           partition by n.user_id
           order by n.id
           rows between unbounded preceding and 1 preceding
         ) as prev_best
  from nets n
),
breaks as (
  select s.user_id, s.created_at, s.game, s.net
  from stepped s
  where s.net > 0
    and (s.prev_best is null or s.net > s.prev_best)
)
select
  p.username,
  p.avatar_url,
  count(*)::bigint as breaks_7d,
  max(b.net)::bigint as best_net_7d
from breaks b
join public.profiles p on p.id = b.user_id
where b.created_at > now() - interval '7 days'
group by p.username, p.avatar_url
order by breaks_7d desc, best_net_7d desc;

grant select on public.stats_record_breaks_week to anon, authenticated, service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Record-break leaderboard view for the stats page',
  'A new anon-readable aggregate ranks players by how often their personal best rose over the last seven days: the running-max window spans each player''s full round history so only true record breaks count, and the weekly filter applies afterwards. The view exposes username, avatar and two aggregates per player — break count and the week''s best net — with no per-round rows and no user_id, matching the stats_* doctrine.',
  '{"version": "record-break-leaders-1.0", "view": "stats_record_breaks_week"}'::jsonb
);
