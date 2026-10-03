-- Record-break history: the rounds that beat every prior round of the same
-- player, most recent first, optionally windowed by created_at (the recap
-- articles use the window; the profile uses the plain last-5). game_rounds is
-- public-read (0003 policy using (true)), so this runs as the INVOKER — no
-- security definer — but the explicit EXECUTE grant is required because 0037
-- stripped the schema defaults that used to hand EXECUTE to the API roles.
-- RETURNS TABLE columns carry the out_ prefix (the 0053 ambiguity lesson).

create or replace function public.player_record_history(
  p_user uuid,
  p_limit int default 5,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (out_created_at timestamptz, out_game text, out_net bigint)
language sql
stable
set search_path = public
as $$
  with nets as (
    select gr.id, gr.created_at, gr.game, gr.payout - gr.bet as net
    from public.game_rounds gr
    where gr.user_id = p_user
      and (p_from is null or gr.created_at >= p_from)
      and (p_to is null or gr.created_at < p_to)
  )
  select w.created_at, w.game, w.net
  from (
    select n.*,
           max(n.net) over (order by n.id rows between unbounded preceding and 1 preceding) as prev_best
    from nets n
  ) w
  where w.net > 0
    and (w.prev_best is null or w.net > w.prev_best)
  order by w.id desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.player_record_history(uuid, int, timestamptz, timestamptz)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Record-break history RPC for profiles and recaps',
  'A new SQL function walks one player''s rounds chronologically and returns the rounds that beat every prior round (a positive net strictly above the running maximum), most recent first, optionally windowed by created_at. The profile''s best-rounds card lists the last five breaks with dates, and arcade recap articles can show the reading player their own breaks inside the covered period. The function runs with invoker rights — game_rounds is publicly readable — and exposes nothing beyond what the feed already shows.',
  '{"version": "record-history-1.0", "function": "player_record_history"}'::jsonb
);
