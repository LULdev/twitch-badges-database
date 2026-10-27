-- 0080 — Badge Rocket (crash): the pending-round table.
--
-- Crash is the arcade's first INTERACTIVE game: the bet starts a flight
-- (crash point rolled and stored server-side, never sent to the client), the
-- player cashes out mid-flight, and the settlement is graded from the server
-- clock. game_rounds cannot hold that mid-air state — a pending flight has
-- no payout and no `won` yet, and its row must NOT appear in the unioned
-- ledger until settled — so the flight lives here and graduates into a
-- normal game_rounds row at settlement, exactly like every other game.
--
-- Columns:
--   crash_x100  rolled crash point as an integer x100 (247 = 2.47x)
--   auto_x100   optional server-enforced auto cash-out target (x100)
--   cashed_x100 the claimed cash-out multiplier (x100), set ONCE by the
--               atomic settle; null = the rocket got there first (loss)
--   settled_at  the settle claim (compare-and-set guard, exactly one winner)
--   recorded_at set AFTER the game_rounds row + counters + coins landed —
--               the replay guard so a crashed settlement attempt re-runs the
--               tail from the frozen cashed_x100 instead of double-paying
--   client_nonce the BET call's nonce: replays resume the flight instead of
--               charging twice (the 0063 doctrine)

create table if not exists public.crash_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bet bigint not null,
  crash_x100 integer not null,
  auto_x100 integer,
  cashed_x100 integer,
  payout bigint,
  won boolean,
  client_nonce text,
  started_at timestamptz not null default now(),
  cashed_at timestamptz,
  settled_at timestamptz,
  recorded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Bet-call idempotency (the play route's (user_id, client_nonce) doctrine).
create unique index if not exists crash_rounds_user_nonce_idx
  on public.crash_rounds (user_id, client_nonce)
  where client_nonce is not null;

-- The engine's per-user "one flight at a time" + re-attach read.
create index if not exists crash_rounds_user_open_idx
  on public.crash_rounds (user_id, started_at desc)
  where settled_at is null;

-- The nightly sweep: everything still unsettled past the 45 s TTL.
create index if not exists crash_rounds_sweep_idx
  on public.crash_rounds (started_at)
  where settled_at is null;

-- Service-role only: every read and write goes through the engine route or
-- the cron sweep, both of which use the admin client. No anon/authenticated
-- policies on purpose (the catalog/heartbeats pattern would leak hidden
-- crash points — this table must never be public-read).
alter table public.crash_rounds enable row level security;
