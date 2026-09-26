-- ============================================================
-- 0041 — badge_stats: measured vs archived owner points
-- ============================================================
-- WHY THIS EXISTS
-- A recovery pass (scripts/sync-archive.ts) replays dated public captures of
-- badge owner pages — Wayback copies of badgebase and potat — into
-- `badge_stats` with `source = 'archive'`, so an owner curve reaches years
-- further back than this site's own potat sampling ever did.
--
-- The regression this migration exists to prevent: `badge_momentum` (0002)
-- derives "24h active-user growth" from the newest `badge_stats` row that is
-- at least 20 hours old, with no source filter. The moment archive rows exist
-- that predicate happily matches a 2023 capture, and what the view calls
-- growth_24h becomes growth since 2023 — a large negative number on every
-- badge that has been around. That value is the `momentum` input of TBRI
-- (src/lib/rarity.ts momentumOf(), 0.10 of the score), so the next potat run
-- would write a wrong rarity_score/rarity_tier across the whole catalog and
-- still report ok. The view is recreated below reading `source = 'measured'`.
--
-- The second guard is structural rather than procedural: the partial unique
-- index below covers archive rows ONLY, so an archived point can never collide
-- with — let alone overwrite — a measured one, whatever the backfill does.
-- There is deliberately no unique constraint on (badge_id, polled_at) across
-- the whole table: measured points legitimately share a timestamp (a chunked
-- batch lands in one now()), and the backfill inserts with plain INSERT and
-- treats 23505 from the partial index as "already stored", never as an upsert.
--
-- READER CHECK — every reader of `badge_stats` in this repository:
--
--   public.badge_momentum (0002) — LATERAL over badge_stats for the 24h
--     baseline, read at src/lib/syncs/potat.ts. REPLACED below: measured rows
--     only. The one reader that was actually wrong.
--   src/lib/queries.ts getBadgeOwnerSeries — feeds the owner chart, which has
--     to draw the two sources as separate series. Reads the new `source`
--     column through the anon client. No SQL-side guard and none wanted: the
--     chart is the one place an archive point belongs. Its limit is applied
--     per source, so a long archive tail cannot starve the measured history.
--   src/lib/queries.ts getBadgeStatsHistory — the pre-archive read, kept
--     unfiltered so it still works on a database this migration has not
--     reached. It selects no `source` column, so it can only ever return
--     whatever the table holds; the chart no longer uses it.
--   src/lib/syncs/potat.ts — the measured writer. Names no source column, so
--     `default 'measured'` keeps every measured point measured. No change to
--     the writer, by design.
--   public.stats_system (0004) — `badge_stat_rows` is a raw row count
--     published on /stats. An archive row IS a row, so counting it is not
--     wrong, but the number would stop corresponding to any sampling cadence.
--     The archive share is therefore published beside it rather than hidden
--     inside a filter.
--   public.latest_badge_stats(int) — does not exist in any migration. 0020
--     recorded it as a production-only orphan from an earlier prototype and
--     revoked its anon/authenticated grants; nothing in the repository calls
--     it. It is unreachable, and on the production database it would now
--     return archive rows. Not dropped here: 0020's reason for leaving an
--     object of unknown provenance alone still holds.
--
-- GRANTS: `badge_stats` keeps the table-level SELECT from 0001 (0032 stripped
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, 0037 deliberately kept SELECT), and a
-- column added later inherits it, so nothing is re-granted. 0040 narrowed a
-- table to per-column grants because it published data the UI refuses to
-- expose (`user_id`, coin-rain `payload`); `source` — a two-value tag the
-- chart labels in the open — and `source_url` — a public web.archive.org URL
-- shown as the provenance link — are not that. If a future migration narrows
-- this table to per-column grants, both must be in the list.

alter table public.badge_stats
  add column if not exists source text not null default 'measured',
  add column if not exists source_url text;

alter table public.badge_stats
  drop constraint if exists badge_stats_source_check;

alter table public.badge_stats
  add constraint badge_stats_source_check
  check (source in ('measured', 'archive'));

-- Archive rows only. Two captures of the same badge at the same second are the
-- same observation, so a re-run of the backfill is a no-op instead of a second
-- point; measured rows are untouched by the constraint entirely.
create unique index if not exists badge_stats_archive_once
  on public.badge_stats (badge_id, polled_at)
  where source = 'archive';

-- 24h active-user growth (rarity momentum input), unchanged apart from the
-- source filter. CREATE OR REPLACE VIEW keeps the view's OID, so the 0002 and
-- 0037 ACLs survive it; the SELECT is re-issued anyway, following 0037's
-- precedent, and is a no-op when the ACL does survive.
create or replace view public.badge_momentum
with (security_invoker = true) as
select
  b.id as badge_id,
  b.active_count,
  b.active_count - coalesce(h.active_count, b.active_count) as growth_24h
from public.badges b
left join lateral (
  -- `source = 'measured'` is the whole point of this file: without it the
  -- `polled_at <= now() - 20 hours` test matches archive captures from years
  -- back and growth_24h reports growth since the capture, not growth since
  -- yesterday.
  select s.active_count
  from public.badge_stats s
  where s.badge_id = b.id
    and s.source = 'measured'
    and s.polled_at <= now() - interval '20 hours'
  order by s.polled_at desc
  limit 1
) h on true
where b.end_date is not null
  and b.status <> 'removed';

grant select on public.badge_momentum to anon, authenticated;

-- Raw table sizes. Appended rather than substituted — CREATE OR REPLACE VIEW
-- only permits appending columns — so the existing count stays the honest
-- total the column is named after, with the archive share broken out so a
-- reader can tell how much of it this site measured itself.
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
  (select count(*) from public.badge_stats where source = 'archive')::bigint as badge_stat_archive_rows;

grant select on public.stats_system to anon, authenticated;

-- PostgREST serves the schema from a cache; refresh it so the new columns, the
-- constraint, the index and the new view column are visible immediately.
notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'badge_stats distinguishes measured owner points from archived ones',
  'A recovery pass will replay dated public captures of badge owner pages into badge_stats tagged source = archive, extending the owner curve years further back than this site''s own potat sampling reaches. The danger was badge_momentum, which derived 24-hour active-user growth from the newest badge_stats row at least 20 hours old without a source filter: once archive rows exist that test matches a 2023 capture, and what the view reports as growth_24h becomes growth since 2023 — a large negative number feeding the momentum term of the rarity score, so the next sync would have rewritten every badge rarity and still reported success. The view is recreated reading measured rows only, and a partial unique index over archive rows alone makes it structurally impossible for an archived point to collide with a measured one, whatever the backfill does. The measured writer needs no change: the new column defaults to measured, so every existing and future potat point is tagged automatically. The stats_system row count now also publishes how much of badge_stats is archived rather than measured, and the public SELECT on badge_stats stays table-level because the new columns are a two-value tag and a public archive URL, not data the API refuses to expose.',
  '{"version": "archived-owner-series-1.0"}'::jsonb
);
