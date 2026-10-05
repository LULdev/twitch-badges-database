-- Idempotency for game-round settlement. A client whose POST timed out after
-- the round committed (the response was lost) retries ~1s+ later; every gate
-- (1/s flood, post-insert race recheck) passes because the first round is
-- older, and a second round settles — the bet and coins move twice. The
-- client now sends a nonce (uuid) per play intent; the first request stores it
-- on the round, a retry with the same nonce replays the committed row instead
-- of settling again. The unique (user_id, nonce) index is the atomic guard the
-- race-recheck comment called for: of two racing same-nonce requests exactly
-- one INSERT wins, the other returns the winner's row.

alter table public.game_rounds
  add column if not exists client_nonce text;

-- Partial index: existing and nonce-less rows (scripts, past rounds) are not
-- covered, so legacy play paths keep today's behaviour.
create unique index if not exists game_rounds_client_nonce_idx
  on public.game_rounds (user_id, client_nonce)
  where client_nonce is not null;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Idempotent game rounds: retries replay instead of double-settling',
  'game_rounds gains a nullable client_nonce with a unique (user_id, nonce) index. The games client sends one nonce per play intent; if the request times out after the round committed, the retry carries the same nonce and the server returns the committed result (same payout, same coins, no second bet) instead of settling a second round. Two racing same-nonce requests are resolved by the index — one settles, the other replays the winner. Legacy paths without a nonce are unaffected.',
  '{"version": "round-nonce-1.0", "column": "game_rounds.client_nonce", "index": "game_rounds_client_nonce_idx"}'::jsonb
);