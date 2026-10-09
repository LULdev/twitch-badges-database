-- 0072 — jackpot pot history: one snapshot row per pot per UTC day, written by
-- the nightly cron/global run. The pots table only ever holds the CURRENT
-- value (plus last-won facts), so the growth story — the pot climbing between
-- hits — was unrecorded; this table is that story, and the public view below
-- is what the /stats "Pot growth" chart reads.
--
-- Cardinality is fixed (15 pots × 1 row/day ≈ 5.5k rows/year), the same class
-- as badge_stats_daily — kept forever, never pruned (pruning would break an
-- all-time growth chart). The nightly writer upserts with
-- ON CONFLICT DO NOTHING: the FIRST snapshot of a day wins, so a manual
-- re-run can never shift the day's representative value, and "rows written"
-- is an honest first-run signal for the changelog.

create table public.jackpot_pot_history (
  scope text not null,
  day date not null,
  pot bigint not null,
  created_at timestamptz not null default now(),
  primary key (scope, day)
);

comment on table public.jackpot_pot_history is
  'Daily pot snapshots (0072): one row per jackpot scope per UTC day, written by the nightly cron/global run. First write of a day wins; never pruned.';

alter table public.jackpot_pot_history enable row level security;

create policy jackpot_pot_history_public_read on public.jackpot_pot_history
  for select using (true);

revoke all on public.jackpot_pot_history from anon, authenticated;
grant select on public.jackpot_pot_history to anon, authenticated;

-- The chart's read: one row per day with the Mega pot and the sum over all
-- pots. ::bigint so PostgREST serializes stable numbers (the stats_* doctrine).
create or replace view public.stats_jackpot_history
with (security_invoker = off) as
select
  day,
  coalesce(sum(pot) filter (where scope = 'mega'), 0)::bigint as mega_pot,
  coalesce(sum(pot), 0)::bigint as total_pot
from public.jackpot_pot_history
group by day;

grant select on public.stats_jackpot_history to anon, authenticated;

insert into public.changelog (kind, title, body, payload)
values (
  'feature',
  'Jackpot pot history',
  'jackpot_pot_history stores one snapshot of every jackpot pot per UTC day (nightly cron/global write, first write of a day wins, never pruned) and the public stats_jackpot_history view aggregates it into the Mega pot and the all-pots total per day for the new /stats growth chart.',
  '{"version": "0072-1.0", "table": "jackpot_pot_history", "view": "stats_jackpot_history"}'::jsonb
);

notify pgrst, 'reload schema';
