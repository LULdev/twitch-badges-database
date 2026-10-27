-- 0081 — Badge Rocket round 2: provably fair + public crash stats.
--
-- Three pieces:
--   1. crash_rounds.server_seed — every flight's crash point is now DERIVED
--      before launch from HMAC-SHA256(server_seed, flight_id) instead of a
--      bare Math.random() roll. The seed stays in this service-only row
--      while the flight is live and publishes with the SETTLED round
--      (game_rounds.result.seed) — anyone can hash it and replay the math.
--      Existing pending rows (pre-fairness) keep NULL: their crash points
--      were honest rolls, just not replayable.
--   2. stats_crash_top_cash — per-user best banked cash-out multiplier, the
--      leaderboards board + the profile/OG best-flight card. Aggregates +
--      public profile columns only (the stats-view doctrine).
--   3. stats_crash_live — "how many rockets are airborne right now, and how
--      high is the highest climb" for the hub strip (rides /api/jackpots).
--      Reads crash_rounds through the owner context (security_invoker =
--      off) but exposes ONLY count + the live curve value exp(0.18·elapsed)
--      capped at the public 250× ceiling — a crash_x100 value can never
--      leak through it, and the TTL filter keeps pre-sweep orphans out.

alter table public.crash_rounds
  add column if not exists server_seed text;

create or replace view public.stats_crash_top_cash with (security_invoker = off) as
select distinct on (gr.user_id)
  gr.user_id,
  p.username,
  p.avatar_url,
  ((gr.result ->> 'cashed')::numeric / 1) as best_mult,
  gr.payout as best_payout,
  gr.created_at as achieved_at
from public.game_rounds gr
join public.profiles p on p.id = gr.user_id
where gr.game = 'crash'
  and gr.won = true
  and gr.result ->> 'cashed' is not null
order by gr.user_id, ((gr.result ->> 'cashed')::numeric) desc, gr.created_at asc;

create or replace view public.stats_crash_live with (security_invoker = off) as
select
  count(*)::int as flights,
  coalesce(
    max(least(exp(0.18 * extract(epoch from (now() - started_at))), 250)),
    1.0
  )::double precision as top_mult
from public.crash_rounds
where settled_at is null
  and started_at > now() - interval '45 seconds';

grant select on public.stats_crash_top_cash to anon, authenticated;
grant select on public.stats_crash_live to anon, authenticated;
