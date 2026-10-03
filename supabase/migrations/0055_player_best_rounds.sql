-- Per-player best-round aggregates for the profile's "your best rounds" row:
-- the best single-round net and the round count per game the player touched.
-- game_rounds is public-read (0003 policy using (true)), so per-user
-- aggregates expose nothing new; the view exists so the profile needs ONE
-- small query instead of paging every round the player ever settled. Runs
-- with owner rights (security_invoker off), matching the stats_* doctrine.

create or replace view public.stats_player_best_rounds
with (security_invoker = off) as
select
  gr.user_id,
  gr.game,
  max(gr.payout - gr.bet)::bigint as best_net,
  count(*)::bigint as rounds,
  max(gr.created_at) as last_played
from public.game_rounds gr
group by gr.user_id, gr.game;

grant select on public.stats_player_best_rounds to anon, authenticated, service_role;

-- The podium achievement (buildStats, service-role client) reads the 0054
-- big-win view; service_role gets it via default privileges, but an explicit
-- grant keeps the read path independent of default-privilege drift.
grant select on public.stats_game_big_wins to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Per-player best-round view powers the profile''s best rounds',
  'A new anon-readable aggregate view groups game_rounds by player and game (best single-round net, round count, last played), so the profile can show "your best rounds" per game with one small query instead of paging a lifetime of rounds. game_rounds is already publicly readable row-by-row, so the aggregate exposes nothing new; it runs with owner rights like every stats_* view.',
  '{"version": "player-best-rounds-1.0", "view": "stats_player_best_rounds"}'::jsonb
);
