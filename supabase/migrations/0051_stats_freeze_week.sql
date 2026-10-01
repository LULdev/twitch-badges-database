-- Public freeze-economy KPI for the status page. user_items is service-role
-- only (0049: RLS enabled, no policies), so per-user rows stay private; the
-- public surface gets two privacy-safe aggregates instead: total freezes in
-- circulation and freeze saves over the rolling last seven days. The count is
-- served by activity_events_kind_idx (0009); the quantity sum scans a handful
-- of rows (one per user who ever held a freeze).

create or replace view public.stats_freeze_week
with (security_invoker = off) as
select
  (select coalesce(sum(quantity), 0)::bigint
     from public.user_items
    where item_key = 'streak_freeze') as freeze_circulation,
  (select count(*)::bigint
     from public.activity_events
    where kind = 'streak_freeze'
      and created_at > now() - interval '7 days') as freeze_saves_7d;

grant select on public.stats_freeze_week to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Status page shows the Streak Freeze economy',
  'A new anon-readable aggregate view exposes two numbers only — Streak Freezes in circulation and freeze saves over the last seven days — and the public status dashboard renders them as a one-line economy KPI under the recap impact. user_items stays service-role-only; the view runs with owner rights (security_invoker off) and returns no per-user data, matching the stats_* doctrine.',
  '{"version": "freeze-week-kpi-1.0", "view": "stats_freeze_week"}'::jsonb
);
