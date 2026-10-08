-- 0070 — stats_jackpot_economy: the public "Jackpot economy" card on /stats.
--
-- One row of aggregates over the public jackpots/jackpot_wins tables (0069):
-- live pots, all-time contributions/paid/hits, the biggest win ever, and the
-- 7-day win activity. Aggregates only — no per-user data — matching the
-- stats_* doctrine (security_invoker = off, blanket select grant, ::bigint
-- columns so PostgREST serializes stable numbers).

create or replace view public.stats_jackpot_economy
with (security_invoker = off) as
select
  (select pot from public.jackpots where scope = 'mega')::bigint as mega_pot,
  (select coalesce(sum(pot), 0) from public.jackpots where kind = 'game')::bigint as game_pots_total,
  (select coalesce(sum(contributions), 0) from public.jackpots)::bigint as contributions_total,
  (select coalesce(sum(total_paid), 0) from public.jackpots)::bigint as total_paid,
  (select coalesce(sum(hits), 0) from public.jackpots)::bigint as hits_total,
  (select coalesce(max(amount), 0) from public.jackpot_wins)::bigint as biggest_win,
  (select count(*) from public.jackpot_wins
     where created_at >= now() - interval '7 days')::bigint as wins_7d,
  (select coalesce(sum(amount), 0) from public.jackpot_wins
     where created_at >= now() - interval '7 days')::bigint as paid_7d;

grant select on public.stats_jackpot_economy to anon, authenticated;

insert into public.changelog (kind, title, body, payload)
values (
  'feature',
  'Public jackpot-economy view',
  'stats_jackpot_economy exposes the progressive-jackpot aggregates (live pots, all-time contributions, payouts, hits, biggest win, 7-day win activity) as one public row for the /stats card. Aggregates only, no per-user data.',
  '{"version": "0070-1.0", "view": "stats_jackpot_economy"}'::jsonb
);

notify pgrst, 'reload schema';
