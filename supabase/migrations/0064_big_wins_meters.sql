-- Pingu Throw distance as a first-class glory metric. The pingu big_win rows
-- already carry the throw distance in their payload ({ meters }), but the
-- view dropped it — the podium, recent list and hub ticker could only show
-- coins. Appending a nullable meters column (payload-only, NULL for slots and
-- scratch) lets the surfaces show "375 m" on pingu rows without touching any
-- other game. Appended at the END of the projection so CREATE OR REPLACE VIEW
-- stays compatible and the existing grants survive.

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
  nullif(ae.payload ->> 'payout', '')::numeric as payout,
  nullif(ae.payload ->> 'meters', '')::numeric as meters
from public.activity_events ae
where ae.kind = 'big_win'
  and ae.username is not null
  and ae.payload ? 'game';

grant select on public.stats_game_big_wins to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Pingu Throw distance on the big-win surfaces',
  'stats_game_big_wins gains a nullable meters column projected from the payload of pingu jackpot rows, so the game-page podium, recent list and hub ticker can show the throw distance next to the coins. Other games keep NULL and render exactly as before; the view is re-created with meters appended at the end so grants and column order stay compatible.',
  '{"version": "big-wins-meters-1.0", "view": "stats_game_big_wins", "column": "meters"}'::jsonb
);