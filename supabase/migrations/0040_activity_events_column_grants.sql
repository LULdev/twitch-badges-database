-- ============================================================
-- 0040 — activity_events: stop publishing the internal id and payload blob
-- ============================================================
-- WHY THIS EXISTS
-- `/api/feed` projects exactly seven columns and says why in a comment: "the
-- internal user id and the raw payload blob are not needed by the feed UI and
-- must not be exposed". The PROJECTION is not the protection. `activity_events`
-- carries `for select using (true)` (0003) and the platform default SELECT grant,
-- which nothing revoked — 0009 hardened only `profiles`, 0032 revoked
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, 0037 deliberately kept SELECT. So anyone
-- holding the publishable key (it ships in the browser bundle) can page the whole
-- history through PostgREST, past the UI's 30-row window, and read two things the
-- app refuses to publish:
--
--   * `user_id` — the internal profile uuid the feed never shows; it resolves to
--     a username, because `profiles.id` is publicly readable (0009).
--   * `payload` — written by the coin-rain path as
--     `{ role: "giver", receiver: profileOwnerId }` and
--     `{ role: "receiver", giver: giverId ?? "anonymous" }`, i.e. the
--     COUNTERPARTY of a coin rain, which the public feed deliberately words as
--     "the collector" and never names.
--
-- The fix is the pattern 0009 already established for `profiles`: revoke the
-- table-level SELECT and grant SELECT per column, limited to what the public
-- readers actually use (`/api/feed/route.ts`, `feed/page.tsx`, and the stats views
-- read `kind`, `xp_amount`, `coins_amount` and the display columns).
--
-- Reader check: /api/feed and the feed page select
--   id, username, avatar_url, kind, title, body, xp_amount, coins_amount, created_at
-- and the `stats_*` views aggregate `kind`, `xp_amount`, `coins_amount`. The
-- service role (every sync, the gamification libs) is unaffected by grants.

revoke select on public.activity_events from anon, authenticated;

grant select (
  id,
  username,
  avatar_url,
  kind,
  title,
  body,
  xp_amount,
  coins_amount,
  created_at
) on public.activity_events to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'activity_events no longer publishes the internal user id or the payload blob',
  'The public feed API projects seven columns and documents that the internal user id and the raw payload must not be exposed — but the table itself kept a permissive SELECT policy plus the platform default grant, so anyone with the publishable key could read the whole activity history through PostgREST, including user_id (which resolves to a username) and, for coin rains, the payload naming the counterparty the feed deliberately never reveals. Migration 0009 fixed exactly this shape for profiles by moving to column-level grants; activity_events now does the same, granting anon and authenticated only the nine columns the feed and the stats views actually read. Every service-role path is unaffected.',
  '{"version": "activity-events-columns-1.0"}'::jsonb
);
