-- Two public, privacy-safe economy views for this round:
--   stats_game_big_wins   — the recent-big-wins list on the game detail pages
--   stats_coin_flow_daily — the community coin-flow card on /stats
-- Both run with owner rights (security_invoker = off) because activity_events
-- grants anon only nine columns (0040) and payload stays unreadable. The views
-- project exactly the fields the surfaces need: username/avatar/coins are
-- already anon-readable on the base table, and game/bet/payout leave the
-- payload only as named columns. Nothing new becomes public — the live feed
-- already shows the same rows; user_id and payload stay out of reach.

create or replace view public.stats_game_big_wins
with (security_invoker = off) as
select
  ae.id,
  ae.created_at,
  ae.username,
  ae.avatar_url,
  ae.coins_amount,
  nullif(ae.payload ->> 'game', '') as game,
  nullif(ae.payload ->> 'bet', '')::numeric as bet,
  nullif(ae.payload ->> 'payout', '')::numeric as payout
from public.activity_events ae
where ae.kind = 'big_win'
  and ae.username is not null
  and ae.payload ? 'game';

grant select on public.stats_game_big_wins to anon, authenticated;

-- One row per UTC day of feed-logged coin movement, gross on both sides (a
-- day that earned and spent keeps both numbers instead of collapsing to its
-- net). Aggregates only — no per-user data, matching the stats_* doctrine.
create or replace view public.stats_coin_flow_daily
with (security_invoker = off) as
select
  (ae.created_at at time zone 'utc')::date as day,
  sum(greatest(ae.coins_amount, 0))::bigint as earned,
  sum(greatest(-ae.coins_amount, 0))::bigint as spent,
  sum(ae.coins_amount)::bigint as net,
  count(*)::bigint as movements
from public.activity_events ae
where ae.coins_amount is not null
  and ae.coins_amount <> 0
group by 1;

grant select on public.stats_coin_flow_daily to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Public economy views: big wins per game and the community coin flow',
  'Two anon-readable aggregate views over activity_events. stats_game_big_wins projects the fields of big_win events — username, avatar, net coins, and game/bet/payout pulled out of the payload as named columns — so the game detail pages can list recent big wins with no service-role read. stats_coin_flow_daily aggregates the feed-logged coin movement per UTC day (gross earned, gross spent, net, movement count) for the community card on /stats. Both run with owner rights (security_invoker off) and expose nothing the live feed does not already show publicly; user_id and payload stay unreachable (0040 column grants).',
  '{"version": "public-economy-views-1.0", "views": ["stats_game_big_wins", "stats_coin_flow_daily"]}'::jsonb
);
