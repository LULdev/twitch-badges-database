-- ============================================================
-- 0043 — close public read access to system_heartbeats
-- ============================================================
-- WHY THIS EXISTS
-- Migration 0004 granted public SELECT on the system_heartbeats BASE table
-- alongside the aggregate stats_uptime_* views. The /api/health route writes
-- raw database error text (schema/hint details) into heartbeat payloads on
-- the documented assumption that the table is service-role-read only — with
-- the public grant that assumption was wrong, and anyone could read the raw
-- table (payloads included) through PostgREST, making the views' column
-- restriction cosmetic.
--
-- Only the service-role client touches the base table (health.ts insert and
-- prune, api/health write). The public pages read the aggregate
-- stats_uptime_* views, which are security_invoker = off and therefore run
-- as their owner — this revoke does not affect them.

revoke select on public.system_heartbeats from anon, authenticated;

-- Keep the aggregate views readable (explicit re-grant so this migration is
-- self-describing even though 0004 already granted it).
grant select on public.stats_uptime_sources to anon, authenticated;
grant select on public.stats_uptime_daily to anon, authenticated;
grant select on public.stats_uptime_hourly to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Heartbeat payloads are no longer publicly readable',
  'The system_heartbeats base table carried a public-read grant from migration 0004, while the health probe writes raw database error text into its payload column under the assumption the table was service-role-only. Public SELECT on the base table is revoked; the aggregate stats_uptime_* views the status and stats pages read are unaffected (security_invoker off, owner-executed).',
  '{"risk": "high", "version": "heartbeats-acl-1.0"}'::jsonb
);
