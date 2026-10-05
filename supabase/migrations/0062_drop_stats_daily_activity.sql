-- Drop the dead stats_daily_activity view (0004). It was created alongside
-- stats_daily_xp / stats_daily_badges / stats_daily_users but never read by
-- any code or depended on by any other view — src/lib/stats.ts reads only the
-- other three. It was anon/authenticated-readable public surface that did
-- nothing and cost nothing to maintain, but exposed a stacked per-kind event
-- breakdown that /stats never rendered. Dropping it in the append-only ledger
-- style: no edits to 0004, just a new migration that reverses that object.

drop view if exists public.stats_daily_activity;

insert into public.changelog (kind, title, body, payload) values (
  'data_sync',
  'Drop the unused stats_daily_activity view',
  'stats_daily_activity (migration 0004) was never read by any page, script or downstream view — src/lib/stats.ts reads only its siblings stats_daily_xp/badges/users. It was public anon surface with no consumer, so it is dropped via a new elimination migration rather than editing 0004.',
  '{"version": "drop-stats-daily-activity-1.0", "dropped": ["public.stats_daily_activity"]}'::jsonb
);