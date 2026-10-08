-- 0068 — badge_stats rollup (IMPROVEMENTS.md Part 1.6)
--
-- badge_stats is an unbounded per-badge time series: the potat sync appends up
-- to one point per badge per hour, forever. The owner-trend chart only ever
-- reads the newest ~250 measured points, so everything older is dead weight
-- the chart pays for in index depth. This migration adds a daily aggregate
-- table plus the idempotent rollup function the nightly cron/global run calls:
--
--   * measured points older than the retention window (default 14 days) are
--     collapsed into one row per (badge, UTC day) carrying the day's last,
--     min and max owner/active counts;
--   * the raw points behind an existing daily row are then deleted;
--   * archive points are NEVER touched — they are a one-time recovery series
--     (sparse, bounded), and the chart draws them as their own line.
--
-- The 14-day floor is load-bearing twice over: badge_momentum reads measured
-- points in the 20–48 h window (0065), and the chart's raw window stays dense
-- enough for hourly resolution. make_interval enforces a 2-day minimum so a
-- stray p_keep_days argument can never starve the momentum view.
--
-- Idempotency: the aggregate INSERT uses ON CONFLICT DO NOTHING and the DELETE
-- only removes raw rows whose (badge_id, day) daily row already exists, so a
-- run killed between the two statements simply finishes the job next run —
-- no day can ever be aggregated twice or deleted before it was aggregated.

create table public.badge_stats_daily (
  badge_id uuid not null references public.badges (id) on delete cascade,
  day date not null,
  owner_last bigint,
  owner_min bigint,
  owner_max bigint,
  active_last bigint,
  samples int not null default 0,
  created_at timestamptz not null default now(),
  primary key (badge_id, day)
);

comment on table public.badge_stats_daily is
  'Daily rollup of measured badge_stats points older than the retention window (0068). One row per badge per UTC day; owner_last/active_last are the day''s closing values.';

alter table public.badge_stats_daily enable row level security;

create policy badge_stats_daily_public_read
  on public.badge_stats_daily
  for select
  using (true);

-- Same grant posture as badge_stats itself: public read, no public write of
-- any kind (0032 stripped the broad DML; this table starts without it).
revoke all on public.badge_stats_daily from anon, authenticated;
grant select on public.badge_stats_daily to anon, authenticated;

create or replace function public.rollup_badge_stats(p_keep_days int default 14)
returns table (out_daily_rows bigint, out_raw_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut timestamptz :=
    now() - make_interval(days => greatest(coalesce(p_keep_days, 14), 2));
begin
  insert into badge_stats_daily
    (badge_id, day, owner_last, owner_min, owner_max, active_last, samples)
  select
    badge_id,
    polled_at::date,
    -- The day's closing value: the latest sample, ignoring null samples so a
    -- trailing unreadable poll cannot null out a day that carried real counts.
    (array_agg(owner_count order by polled_at desc)
       filter (where owner_count is not null))[1],
    min(owner_count),
    max(owner_count),
    (array_agg(active_count order by polled_at desc)
       filter (where active_count is not null))[1],
    count(*)
  from badge_stats
  where source = 'measured'
    and polled_at < v_cut
  group by badge_id, polled_at::date
  on conflict (badge_id, day) do nothing;

  get diagnostics out_daily_rows = row_count;

  with deleted as (
    delete from badge_stats s
    where s.source = 'measured'
      and s.polled_at < v_cut
      and exists (
        select 1
        from badge_stats_daily d
        where d.badge_id = s.badge_id
          and d.day = s.polled_at::date
      )
    returning 1
  )
  select count(*) into out_raw_deleted from deleted;

  -- PL/pgSQL TABLE-returning functions emit NOTHING unless the body executes
  -- RETURN NEXT / RETURN QUERY — assigning the OUT columns alone returns ZERO
  -- rows (the mutation still commits, the caller just sees an empty set).
  -- This bare RETURN NEXT emits the one row the OUT columns describe.
  return next;
end;
$$;

revoke all on function public.rollup_badge_stats(int)
  from anon, authenticated, public;
grant execute on function public.rollup_badge_stats(int) to service_role;

-- Surface the rollup's footprint on /stats: badge_stat_rows stays the honest
-- RAW row count (it visibly shrinks when retention runs — that is the feature
-- working), with the daily aggregate broken out next to it, mirroring how
-- 0041 broke out the archive share. CREATE OR REPLACE VIEW can only append
-- columns, so this is the full 0041 projection plus one column.
create or replace view public.stats_system
with (security_invoker = off) as
select
  (select count(*) from public.badges)::bigint as badges,
  (select count(*) from public.badge_stats)::bigint as badge_stat_rows,
  (select count(*) from public.badge_events)::bigint as badge_events,
  (select count(*) from public.profiles)::bigint as profiles,
  (select count(*) from public.user_inventory)::bigint as inventory_rows,
  (select count(*) from public.blog_posts)::bigint as blog_posts,
  (select count(*) from public.changelog)::bigint as changelog_entries,
  (select count(*) from public.notifications)::bigint as notifications,
  (select count(*) from public.push_subscriptions)::bigint as push_subscriptions,
  (select count(*) from public.activity_events)::bigint as activity_events,
  (select count(*) from public.game_rounds)::bigint as game_rounds,
  (select count(*) from public.steal_attempts)::bigint as steal_attempts,
  (select count(*) from public.user_achievements)::bigint as achievement_unlocks,
  (select count(*) from public.system_heartbeats)::bigint as heartbeats,
  (select max(last_seen_at) from public.badges) as badges_last_seen,
  (select max(last_polled_at) from public.badges) as badges_last_polled,
  (select max(created_at) from public.activity_events) as last_activity,
  (select max(created_at) from public.changelog) as last_change,
  (select max(published_at) from public.blog_posts) as last_post,
  (select count(*) from public.badge_stats where source = 'archive')::bigint as badge_stat_archive_rows,
  (select count(*) from public.badge_stats_daily)::bigint as badge_stat_daily_rows;

grant select on public.stats_system to anon, authenticated;

notify pgrst, 'reload schema';
