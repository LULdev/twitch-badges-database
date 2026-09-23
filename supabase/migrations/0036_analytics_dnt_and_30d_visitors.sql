-- ============================================================
-- 0036 — analytics correctness: DNT is not a visitor, and the public 30-day
--        tile gets a number that matches its own window
-- ============================================================
-- WHY THIS EXISTS
-- (a) 0025 defined `stats_analytics_daily.visitors` as `count(distinct
--     visitor_hash)` over every row, but /api/track deliberately stores '' for a
--     visitor who sends Do Not Track — and `stats_analytics_summary` already
--     excludes that value from every visitor count. The '' was therefore one
--     extra "distinct visitor" on any day that saw a DNT hit, so the admin trend
--     line showed a phantom visitor.
-- (b) `unique_visitors` has no time window (whole table), yet the public /stats
--     page renders it as the hint of the "Views 30d" tile — a publicly displayed
--     number labelled as belonging to a 30-day figure. This appends a windowed
--     count so the label can be true.
--
-- Both views are replaced with CREATE OR REPLACE, which keeps their ACL and only
-- permits APPENDING columns; the existing columns keep their names, order and
-- types. The 0030 revokes are re-asserted so the replacements cannot inherit a
-- public grant — `getAnalytics` reads them with the service role.

create or replace view public.stats_analytics_daily with (security_invoker = off) as
select date_trunc('day', ts)::date as day,
       count(*)::bigint as hits,
       count(distinct visitor_hash) filter (where visitor_hash <> '')::bigint as visitors
  from public.analytics_events
 where ts > now() - interval '90 days'
 group by 1 order by 1;

create or replace view public.stats_analytics_summary with (security_invoker = off) as
select
  (select count(*) from public.analytics_events)::bigint as total_hits,
  (select count(distinct visitor_hash) from public.analytics_events where visitor_hash <> '')::bigint as unique_visitors,
  (select count(*) from public.analytics_events where ts > now() - interval '1 day')::bigint as hits_24h,
  (select count(*) from public.analytics_events where ts > now() - interval '7 days')::bigint as hits_7d,
  (select count(*) from public.analytics_events where ts > now() - interval '30 days')::bigint as hits_30d,
  (select count(*) from public.analytics_events where ts > now() - interval '90 days')::bigint as hits_90d,
  (select count(distinct visitor_hash) from public.analytics_events
     where visitor_hash <> '' and ts > now() - interval '5 minutes')::bigint as online_now,
  (select coalesce(round(avg(duration_s), 1), 0) from public.analytics_events
     where duration_s is not null and ts > now() - interval '30 days')::numeric as avg_duration_s,
  (select count(distinct visitor_hash) from public.analytics_events
     where visitor_hash <> '' and ts > now() - interval '30 days')::bigint as unique_visitors_30d;

revoke all on public.stats_analytics_summary from anon, authenticated;
revoke all on public.stats_analytics_daily from anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Analytics: Do Not Track no longer counts as a phantom visitor; 30-day unique visitors published',
  'Migration 0025 counted distinct visitor_hash including the empty string that /api/track stores for a Do Not Track visitor, so any day with a DNT hit showed one extra visitor on the admin trend line even though the summary view already excluded it. This migration redefines stats_analytics_daily.visitors to ignore the empty hash, and appends unique_visitors_30d to stats_analytics_summary so the public /stats "Views 30d" tile can display a 30-day unique count instead of the whole-table unique_visitors. The 0030 revokes are re-asserted so the replaced views stay service-role-only.',
  '{"version": "analytics-dnt-1.0"}'::jsonb
);

-- PostgREST serves the schema from a cache; refresh it so the appended column is
-- visible immediately (0008-0012 convention).
notify pgrst, 'reload schema';
