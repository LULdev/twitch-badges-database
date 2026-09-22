-- v10-1: the coin-rain gate was a read-then-write on `activity_events` whose
-- filter could never match the row the write produced. The query looked for
-- `payload.giver = <salted IP hash>`, but the row was written with
-- `payload.giver = "anonymous"`, so for a logged-out visitor the count was
-- always 0 and /api/coinrain was an unbounded +1-coin faucet against any
-- profile. Only signed-in givers were actually gated.
--
-- Fixing it inside the payload is not an option: `activity_events` is
-- public-read (policy `activity_public_read`), so an IP hash written there would
-- be readable by anyone holding the anon key. The gate therefore lives in its
-- own table with RLS enabled and no policy at all — reachable only through the
-- service role.
--
-- The primary key is the point: two parallel requests cannot both insert the
-- same (owner, giver, day), so this is a real compare-and-set rather than the
-- optimistic read-then-write it replaces.

create table if not exists public.coin_rain_gate (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  giver_key text not null,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, giver_key, day)
);

alter table public.coin_rain_gate enable row level security;

-- No policy on purpose: anon/authenticated must never read the giver keys.
revoke all on public.coin_rain_gate from anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Coin rain: once-per-day gate is now atomic and actually binds',
  'The coin-rain dedup filtered activity_events for payload.giver = <salted IP hash> while the inserted row carried payload.giver = "anonymous", so the check never matched for logged-out visitors and every POST awarded another coin. Migration 0014 adds coin_rain_gate with the primary key (owner_id, giver_key, day), which makes the gate a true compare-and-set and keeps the IP hash out of the public-read activity_events table. The window changes from a rolling 24 hours to a UTC calendar day.',
  '{"version": "coin-rain-gate-1.0"}'::jsonb
);

notify pgrst, 'reload schema';