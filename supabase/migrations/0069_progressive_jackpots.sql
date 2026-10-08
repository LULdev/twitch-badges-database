-- 0069 — progressive jackpots (two tiers)
--
-- Every arcade round that LOSES coins feeds two pots, both admin-tunable as
-- economy settings (percent of the round's net loss):
--   * the GAME pot of the game the coins were lost in, and
--   * the global MEGA pot every game pays into.
-- Contributions are bookkeeping over coins the player already lost — nothing
-- is deducted beyond the loss itself. Every settled round (and each daily
-- wheel spin) additionally rolls a small hit chance per pot; a hit pays the
-- current pot (never less than the seed) straight to the player's balance and
-- resets the pot to its seed.
--
-- `jackpot_round` is the single writer, one transaction per call, following
-- the purchase_item doctrine (0052/0053/0059/0067): row-locked compare-and-set
-- on the pot rows, out_* OUT-param naming, and the payout's activity_events
-- feed row written INSIDE the RPC so a claimed pot can never go unpaid and a
-- paid pot can never go unrecorded. Supabase service role only — the roll and
-- the rates live in the server (games.ts / wheel.ts), which is the same trust
-- boundary every other money RPC already uses.

create table public.jackpots (
  scope text primary key,
  kind text not null check (kind in ('mega', 'game')),
  pot bigint not null default 0,
  contributions bigint not null default 0,
  contributions_rounds bigint not null default 0,
  hits bigint not null default 0,
  total_paid bigint not null default 0,
  last_won_at timestamptz,
  last_winner text,
  last_win_amount bigint,
  updated_at timestamptz not null default now()
);

comment on table public.jackpots is
  'Progressive jackpot pots (0069). scope = ''mega'' or a game id; pot is the live amount, seeded at reset so a hit always pays at least the seed.';

create index jackpots_kind_idx on public.jackpots (kind);

-- Winner history — public read (the hub strip and game pages show "last won
-- by"); user_id is ON DELETE SET NULL so deleting an account keeps the
-- historical fact with the denormalized username.
create table public.jackpot_wins (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  username text,
  scope text not null,
  kind text not null check (kind in ('mega', 'game')),
  amount bigint not null,
  game text,
  created_at timestamptz not null default now()
);

create index jackpot_wins_created_idx on public.jackpot_wins (created_at desc);

alter table public.jackpots enable row level security;
alter table public.jackpot_wins enable row level security;

create policy jackpots_public_read on public.jackpots
  for select using (true);
create policy jackpot_wins_public_read on public.jackpot_wins
  for select using (true);

revoke all on public.jackpots from anon, authenticated;
revoke all on public.jackpot_wins from anon, authenticated;
grant select on public.jackpots to anon, authenticated;
grant select on public.jackpot_wins to anon, authenticated;

-- Seed rows. The seed AMOUNTS are the economy defaults (jackpotGameSeed 250 /
-- jackpotMegaSeed 2500) — editable in the panel from TS with no SQL, and the
-- RPC takes them as parameters on every call so a settings change applies to
-- the very next reset without touching these rows. The game rows exist so the
-- first page paint shows live pots; jackpot_round self-heals a missing row
-- (a game added after this migration) with pot 0. ON CONFLICT keeps the file
-- safe to replay against a database that already has the rows.
insert into public.jackpots (scope, kind, pot) values
  ('mega', 'mega', 2500),
  ('rps', 'game', 250),
  ('slots', 'game', 250),
  ('shoot', 'game', 250),
  ('memory', 'game', 250),
  ('quiz', 'game', 250),
  ('coinflip', 'game', 250),
  ('hilo', 'game', 250),
  ('roulette', 'game', 250),
  ('blackjack', 'game', 250),
  ('vault', 'game', 250),
  ('scratch', 'game', 250),
  ('tower', 'game', 250),
  ('catcher', 'game', 250),
  ('pingu', 'game', 250)
on conflict (scope) do nothing;

create or replace function public.jackpot_round(
  p_user_id uuid,
  p_game text,
  p_loss bigint,
  p_game_rate double precision,
  p_mega_rate double precision,
  p_game_seed bigint,
  p_mega_seed bigint,
  p_game_hit boolean,
  p_mega_hit boolean
)
returns table (
  out_game_pot bigint,
  out_mega_pot bigint,
  out_game_win bigint,
  out_mega_win bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loss bigint := greatest(coalesce(p_loss, 0), 0);
  v_game_amt bigint :=
    floor(v_loss * greatest(coalesce(p_game_rate, 0), 0))::bigint;
  v_mega_amt bigint :=
    floor(v_loss * greatest(coalesce(p_mega_rate, 0), 0))::bigint;
  v_uname text;
  v_avatar text;
  v_game_win bigint := 0;
  v_mega_win bigint := 0;
begin
  if p_user_id is null then
    raise exception 'jackpot_round requires a user';
  end if;

  select username, avatar_url into v_uname, v_avatar
  from profiles where id = p_user_id;

  -- ── game pot ──────────────────────────────────────────────────────────────
  if p_game is not null then
    insert into jackpots (scope, kind, pot)
      values (p_game, 'game', 0)
      on conflict (scope) do nothing;

    update jackpots set
      pot = pot + v_game_amt,
      contributions = contributions + v_game_amt,
      contributions_rounds =
        contributions_rounds + (case when v_loss > 0 then 1 else 0 end),
      updated_at = now()
    where scope = p_game;

    if coalesce(p_game_hit, false) then
      update jackpots set
        pot = greatest(coalesce(p_game_seed, 0), 0),
        hits = hits + 1,
        total_paid = total_paid + greatest(pot, coalesce(p_game_seed, 0)),
        last_won_at = now(),
        last_winner = v_uname,
        last_win_amount = greatest(pot, coalesce(p_game_seed, 0)),
        updated_at = now()
      where scope = p_game
      returning last_win_amount into v_game_win;
    end if;
  end if;

  -- ── mega pot ──────────────────────────────────────────────────────────────
  -- The wheel calls this with p_game null and p_loss 0: no contribution, but
  -- the daily spin still rolls the Mega pot.
  update jackpots set
    pot = pot + v_mega_amt,
    contributions = contributions + v_mega_amt,
    contributions_rounds =
      contributions_rounds + (case when v_loss > 0 then 1 else 0 end),
    updated_at = now()
  where scope = 'mega';

  if coalesce(p_mega_hit, false) then
    update jackpots set
      pot = greatest(coalesce(p_mega_seed, 0), 0),
      hits = hits + 1,
      total_paid = total_paid + greatest(pot, coalesce(p_mega_seed, 0)),
      last_won_at = now(),
      last_winner = v_uname,
      last_win_amount = greatest(pot, coalesce(p_mega_seed, 0)),
      updated_at = now()
    where scope = 'mega'
    returning last_win_amount into v_mega_win;
  end if;

  -- ── payouts: coins + history + feed rows, all inside this transaction ────
  if v_game_win > 0 then
    update user_progress
      set coins = coins + v_game_win, updated_at = now()
      where user_id = p_user_id;

    insert into jackpot_wins (user_id, username, scope, kind, amount, game)
      values (p_user_id, v_uname, p_game, 'game', v_game_win, p_game);

    insert into activity_events
      (user_id, username, avatar_url, kind, title, coins_amount, payload)
    values (
      p_user_id, v_uname, v_avatar, 'jackpot_win',
      'hit the ' || p_game || ' jackpot',
      v_game_win,
      jsonb_build_object('scope', p_game, 'kind', 'game', 'game', p_game)
    );
  end if;

  if v_mega_win > 0 then
    update user_progress
      set coins = coins + v_mega_win, updated_at = now()
      where user_id = p_user_id;

    insert into jackpot_wins (user_id, username, scope, kind, amount, game)
      values (p_user_id, v_uname, 'mega', 'mega', v_mega_win, p_game);

    insert into activity_events
      (user_id, username, avatar_url, kind, title, coins_amount, payload)
    values (
      p_user_id, v_uname, v_avatar, 'jackpot_win',
      'hit the MEGA JACKPOT',
      v_mega_win,
      jsonb_build_object('scope', 'mega', 'kind', 'mega', 'game', p_game)
    );
  end if;

  select pot into out_game_pot from jackpots where scope = p_game;
  select pot into out_mega_pot from jackpots where scope = 'mega';
  out_game_win := v_game_win;
  out_mega_win := v_mega_win;

  -- PL/pgSQL TABLE-returning functions emit NOTHING unless the body executes
  -- RETURN NEXT / RETURN QUERY — assigning the OUT columns alone returns ZERO
  -- rows (a scalar-return function would; a set-returning one does not). This
  -- bare RETURN NEXT emits exactly the one row the OUT columns describe.
  return next;
end;
$$;

revoke all on function public.jackpot_round(uuid, text, bigint, double precision, double precision, bigint, bigint, boolean, boolean)
  from anon, authenticated, public;
grant execute on function public.jackpot_round(uuid, text, bigint, double precision, double precision, bigint, bigint, boolean, boolean)
  to service_role;

notify pgrst, 'reload schema';
