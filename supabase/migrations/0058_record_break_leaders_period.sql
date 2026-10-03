-- Record-break leaderboard, parameterized: p_days = 7 / 30 / NULL (all time).
-- Same break semantics as 0056/0057 (a positive net strictly above the
-- running max of every prior round of the SAME player, window over the FULL
-- history, period filter applied afterwards) — this function SUPERSEDES the
-- 0057 view, which is dropped here: one code path for all three periods
-- instead of a view per window. Runs as the INVOKER (game_rounds is
-- public-read); explicit EXECUTE grants because 0037 stripped the defaults.
-- out_* RETURN-TABLE columns per the 0053 ambiguity lesson.

create or replace function public.record_break_leaders(
  p_days int default null
)
returns table (out_username text, out_avatar_url text, out_breaks bigint, out_best_net bigint)
language sql
stable
set search_path = public
as $$
  with nets as (
    select gr.id, gr.user_id, gr.created_at, gr.payout - gr.bet as net
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
    select s.user_id, s.created_at, s.net
    from stepped s
    where s.net > 0
      and (s.prev_best is null or s.net > s.prev_best)
  )
  select
    p.username,
    p.avatar_url,
    count(*)::bigint,
    max(b.net)::bigint
  from breaks b
  join public.profiles p on p.id = b.user_id
  where p_days is null or b.created_at > now() - (p_days || ' days')::interval
  group by p.username, p.avatar_url
  order by count(*) desc, max(b.net) desc
  limit 10;
$$;

grant execute on function public.record_break_leaders(int)
  to anon, authenticated, service_role;

drop view if exists public.stats_record_breaks_week;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'The record-break leaderboard gains a period parameter',
  'The 0057 leaderboard view is superseded by a parameterized SQL function: p_days 7 or 30 windows the breaks to that period, NULL counts all time — same break semantics (a positive net strictly above every prior round of the same player, window over the full history). The stats page serves all three periods from one code path through a ?period= toggle, the card links every player name to their profile, and the view is dropped so there is exactly one leaderboard implementation.',
  '{"version": "record-break-leaders-2.0", "function": "record_break_leaders", "supersedes": "stats_record_breaks_week"}'::jsonb
);
