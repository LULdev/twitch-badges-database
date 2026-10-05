-- Public per-game weekly win total for the game pages' login-wall teaser:
-- "Players have won N BadgesCoins here this week". Aggregates only, over
-- game_rounds (already public-read), 7-day window at read time. Runs with
-- owner rights (security_invoker = off) like the other stats_* views so the
-- aggregate is complete over RLS tables while exposing no user rows.

create or replace view public.stats_game_wins_week
with (security_invoker = off) as
select
  game,
  sum(payout)::bigint as won_week,
  count(*)::bigint as win_rounds
from public.game_rounds
where won
  and created_at > now() - interval '7 days'
group by game;

grant select on public.stats_game_wins_week to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Per-game weekly win total view for the login-wall teaser',
  'stats_game_wins_week aggregates the payouts of winning game_rounds per game over a rolling 7-day window (won_week, win_rounds) and is anon-readable with owner rights (security_invoker off), matching the 0054 view doctrine. The game pages'' login wall reads it to show "players have won N BadgesCoins here this week" — social proof on the one surface every anonymous arcade visitor sees. The line renders only when the week actually has wins.',
  '{"version": "game-wins-week-1.0", "view": "stats_game_wins_week"}'::jsonb
);
