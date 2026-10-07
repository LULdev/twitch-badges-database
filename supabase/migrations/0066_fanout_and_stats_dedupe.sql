-- ============================================================
-- 0066 — new-badge fan-out and badge_stats point dedupe
-- ============================================================
-- The sync engines behind BOTH the Vercel crons and the admin/manual
-- triggers can overlap — the daily 06:00 UTC global cron with a manual
-- admin sync, the 06:30 UTC potat cron with the GitHub-Actions :07 potat
-- workflow (whose queue lags and coalesces). Each overlapping run reads its
-- own snapshot before the other's writes commit, so both concluded "new"
-- and both wrote one-off rows nothing else deduped:
--
-- 1) The global new-badge fan-out (badge_events 'added' -> changelog ->
--    notification -> web push -> drop post) ran twice: duplicate 'added'
--    events, a duplicate "New badge" changelog row, a duplicate notification
--    and a SECOND push blast to every subscriber. Only createDropPost was
--    idempotent. The partial unique index below is the durable gate: a badge
--    enters the catalog exactly once (catalog rows are never deleted, only
--    demoted), so one 'added' event per badge_id is the single source of
--    truth for "already fanned out".
-- 2) potat runs landing in the same polled_at for the same badge wrote two
--    badge_stats points for one observation (the in-engine statByKey
--    collapse already removed within-run duplicates; this removes the
--    cross-run ones). The writer now inserts with ON CONFLICT
--    (badge_id, polled_at) DO NOTHING via PostgREST ignore-duplicates.
--
-- The badge_stats index is deliberately NOT partial on source = 'measured':
-- PostgREST's conflict target is a plain column list and cannot express an
-- index predicate, and PostgreSQL's unique-index inference refuses a partial
-- index whose predicate is not in the conflict target (42P10). A full unique
-- index is safe for the archive writer: scripts/sync-archive.ts applies the
-- measured floor three times and inserts only points STRICTLY EARLIER than
-- the earliest measured point, so an archived polled_at can never equal a
-- measured one.
--
-- The DELETE passes are prerequisites, not cleanups: production already
-- holds the duplicates this bug produced, and CREATE UNIQUE INDEX would
-- fail (23505) on them.

-- badge_events: one 'added' event per badge, earliest write wins. The
-- 'removed'/'updated'/'restocked' events are untouched (they are not unique).
with dups as (
  select id,
         row_number() over (
           partition by badge_id
           order by id
         ) as rn
  from public.badge_events
  where kind = 'added'
)
delete from public.badge_events
where id in (select id from dups where rn > 1);

create unique index if not exists badge_events_added_once
  on public.badge_events (badge_id)
  where kind = 'added';

-- badge_stats: one point per (badge, polled_at). When a colliding pair spans
-- sources the measured row wins — the live series is the truth, and an
-- archive point at the same timestamp was a re-capture of the same
-- observation.
with dups as (
  select id,
         row_number() over (
           partition by badge_id, polled_at
           order by (source = 'measured') desc, id
         ) as rn
  from public.badge_stats
)
delete from public.badge_stats
where id in (select id from dups where rn > 1);

create unique index if not exists badge_stats_polled_once
  on public.badge_stats (badge_id, polled_at);

insert into public.changelog (kind, title, body, payload) values (
  'data_sync',
  'New-badge fan-out and badge_stats points are now deduplicated under overlapping sync runs',
  'The sync engines behind the Vercel crons and the admin/manual triggers can overlap (the 06:00 global cron with a manual sync, the potat cron with the lagging GitHub-Actions workflow), and each overlapping run read its own catalog snapshot before the other committed — so both concluded a badge was new and both wrote the one-off fan-out rows: duplicate badge_events "added" events, a duplicate "New badge" changelog row, a duplicate notification and a second web-push blast (only the drop post was idempotent). A partial unique index now allows exactly one "added" event per badge, and the engine skips the whole fan-out when an overlapping run already fanned the badge out (guard read + 23505 handling at the events insert). badge_stats likewise got a unique (badge_id, polled_at) index so a lagged potat run landing in the same second no longer appends a double-counted chart point; the writer inserts with ON CONFLICT DO NOTHING. Existing duplicates in both tables were removed as a prerequisite pass.',
  '{"version": "sync-dedupe-1.0", "indexes": ["badge_events_added_once", "badge_stats_polled_once"]}'::jsonb
);

notify pgrst, 'reload schema';