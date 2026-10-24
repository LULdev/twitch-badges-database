-- 0075 — economy alerts: the nightly abuse scan.
--
-- Two gates over the arcade economy, evaluated once per night by the
-- cron/global run (security-definer RPC, service-role execute only):
--   * win_rate: lifetime win rate > 60% over 200+ settled rounds
--     (user_progress counters — no windowing needed for a this-lifetime gate)
--   * wager_spike: this week's turnover more than TRIPLE the prior week's
--     over a minimum volume (both windows aggregated from game_rounds in the
--     same query — the site is small, a weekly grouped scan is cheap)
--
-- Findings land in economy_alerts (service-role-only per 0074 — member names
-- must never reach the public /status message surface) deduped by
-- (user_id, day, kind): the first scan of a day is authoritative, re-runs
-- change nothing. The cron payload carries ONLY counts/flags.

create table public.economy_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  username text,
  kind text not null check (kind in ('win_rate', 'wager_spike')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  day date generated always as ((created_at at time zone 'utc')::date) stored,
  unique (user_id, day, kind)
);

create index economy_alerts_created_idx on public.economy_alerts (created_at desc);

alter table public.economy_alerts enable row level security;

-- Service-role only (0074 pattern + the explicit revoke Supabase default
-- privileges make necessary).
revoke all on public.economy_alerts from anon, authenticated;
grant select, insert on public.economy_alerts to service_role;

create or replace function public.economy_scan_alerts()
returns table (out_alerts bigint, out_new_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end timestamptz := now();
  v_week_start timestamptz := now() - interval '7 days';
  v_prior_start timestamptz := now() - interval '14 days';
begin
  -- Gate 1: lifetime win rate (cheap — user_progress only).
  insert into economy_alerts (user_id, username, kind, detail)
  select
    pr.user_id,
    p.username,
    'win_rate',
    jsonb_build_object(
      'win_rate', round(pr.games_won::numeric / pr.games_played * 100, 1),
      'rounds', pr.games_played
    )
  from public.user_progress pr
  join public.profiles p on p.id = pr.user_id
  where pr.games_played >= 200
    and pr.games_won::numeric / pr.games_played > 0.6
  on conflict do nothing;

  -- Gate 2: week-over-week wager spike (game_rounds grouped per user and
  -- window; only counts when BOTH weeks have real volume so a first active
  -- week is a spike of nothing, not an alarm).
  with weeks as (
    select
      gr.user_id,
      sum(gr.bet) filter (where gr.created_at >= v_week_start) as this_week,
      sum(gr.bet) filter (
        where gr.created_at >= v_prior_start and gr.created_at < v_week_start
      ) as prior_week
    from public.game_rounds gr
    where gr.created_at >= v_prior_start
    group by gr.user_id
  )
  insert into economy_alerts (user_id, username, kind, detail)
  select
    w.user_id,
    p.username,
    'wager_spike',
    jsonb_build_object(
      'this_week', w.this_week,
      'prior_week', w.prior_week,
      'factor', round(w.this_week::numeric / greatest(w.prior_week, 1), 1)
    )
  from weeks w
  join public.profiles p on p.id = w.user_id
  where coalesce(w.this_week, 0) > 1000
    and coalesce(w.prior_week, 0) > 100
    and w.this_week > 3 * w.prior_week
  on conflict do nothing;

  get diagnostics out_new_rows = row_count;

  select count(*)::int into out_alerts
  from economy_alerts
  where day = (now() at time zone 'utc')::date;

  -- PL/pgSQL RETURNS TABLE: emit the row (the 0068/0069 lesson).
  return next;
end;
$$;

revoke all on function public.economy_scan_alerts()
  from anon, authenticated, public;
grant execute on function public.economy_scan_alerts() to service_role;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Nightly economy-abuse scan',
  'The economy_scan_alerts RPC runs in the nightly cron/global pass and records two abuse signals into the service-role-only economy_alerts table: a lifetime win rate above 60% over 200+ rounds, and a week-over-week wager spike (this week more than triple the prior week over real volume). Deduped per user/day/kind (first scan of a day wins); the cron payload carries only counts. Alerts surface in the ACP stats tab — never on the public /status surface.',
  '{"version": "0075-1.0", "table": "economy_alerts", "rpc": "economy_scan_alerts"}'::jsonb
);

notify pgrst, 'reload schema';
