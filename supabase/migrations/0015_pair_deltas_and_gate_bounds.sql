-- v11-2: the steal moved coins with two separate `add_coins` calls. Each is
-- atomic on its own, but the thief was debited and the victim credited in
-- different statements — an error between them (or a timeout) left the transfer
-- half-applied and, because the flood window had already been consumed, locked
-- the thief out for five minutes on a request whose coins had partly moved.
--
-- `apply_pair_deltas` performs both deltas in one statement, so the pair either
-- lands completely or not at all. Clamping matches `add_coins`
-- (`greatest(0, coins + delta)`) so the semantics of a single delta are
-- unchanged.
--
-- v11-5: the coin-rain gate accepted `giver_key = ''` and unbounded text. Only
-- the application prevented an empty key from collapsing every anonymous
-- visitor into one slot; a length CHECK makes that a schema guarantee too. The
-- longest legitimate key is the 40-character IP hash.

create or replace function public.apply_pair_deltas(
  p_a uuid,
  p_a_delta bigint,
  p_b uuid,
  p_b_delta bigint
)
returns table (a_coins bigint, b_coins bigint)
language sql
as $$
  with first as (
    update public.user_progress
       set coins = greatest(0, coins + p_a_delta),
           updated_at = now()
     where user_id = p_a
    returning coins
  ), second as (
    update public.user_progress
       set coins = greatest(0, coins + p_b_delta),
           updated_at = now()
     where user_id = p_b
    returning coins
  )
  select (select coins from first), (select coins from second);
$$;

revoke all on function public.apply_pair_deltas(uuid, bigint, uuid, bigint) from public;
revoke all on function public.apply_pair_deltas(uuid, bigint, uuid, bigint) from anon, authenticated;
grant execute on function public.apply_pair_deltas(uuid, bigint, uuid, bigint) to service_role;

alter table public.coin_rain_gate
  add constraint coin_rain_gate_giver_key_len
  check (length(giver_key) between 8 and 128);

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Steal settlement commits both balances at once, and the rain gate keys are bounded',
  'The steal debited the thief and credited the victim with two separate add_coins calls: each was atomic, but an error between them left the transfer half-applied while the five-minute flood window had already been consumed. apply_pair_deltas performs both deltas in one statement with the same greatest(0, …) clamping. The coin-rain gate also accepted an empty or unbounded giver_key — only the application stopped an empty key from collapsing every anonymous visitor into one slot — so a length CHECK now guarantees it in the schema too.',
  '{"version": "pair-deltas-1.0"}'::jsonb
);

notify pgrst, 'reload schema';