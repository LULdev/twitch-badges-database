-- ============================================================
-- 0035 — atomic profile/blog view dedup + bounded showcase slots
-- (the proposal numbered this 0034; 0034 is the gate-release migration)
-- ============================================================
-- WHY THIS EXISTS
-- (a) `profile_visits` (and `blog_views`) enforces its 5-minute per-IP dedup as an
--     application-level read-then-insert: two overlapping requests both read "no recent
--     visit" and both insert, so one visitor yields two rows and two counter bumps. The
--     counter bump is already atomic (bump_view_count); the dedup was not, and a unique
--     index is the only atomic form. The writer supplies a fixed 5-minute bucket ON TOP
--     of the existing sliding read check, so sequential behaviour is unchanged and only
--     the race is closed. Existing rows keep a NULL bucket and are exempt (partial
--     index), so no row is deleted and the index cannot fail on historical duplicates.
-- (b) `profiles.showcase_slots` is public-read jsonb with no CHECK; a non-app writer
--     could store an unbounded array. The write path now bounds it and checks ownership;
--     this is the matching database-level backstop.

alter table public.profile_visits
  add column if not exists dedup_bucket bigint;

alter table public.blog_views
  add column if not exists dedup_bucket bigint;

create unique index if not exists profile_visits_dedup_unique
  on public.profile_visits (profile_id, ip_hash, dedup_bucket)
  where dedup_bucket is not null;

create unique index if not exists blog_views_dedup_unique
  on public.blog_views (post_id, ip_hash, dedup_bucket)
  where dedup_bucket is not null;

alter table public.profiles
  drop constraint if exists profiles_showcase_slots_shape;
alter table public.profiles
  add constraint profiles_showcase_slots_shape
  check (
    jsonb_typeof(showcase_slots) = 'array'
    and jsonb_array_length(showcase_slots) <= 6
  );

-- PostgREST serves the schema from a cache; refresh it so the new columns, indexes
-- and constraint are visible immediately.
notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'View dedup is atomic; showcase slots are bounded and ownership-checked',
  'profile_visits and blog_views deduplicated their five-minute window with a read-then-insert, so two overlapping requests both inserted and both bumped the view counter. A partial unique index on the pair of columns that identify a visit (profile_id, ip_hash) plus the 5-minute bucket the writer supplies makes the guard atomic for new rows; existing rows keep a NULL bucket and are untouched, so the index cannot fail on historical duplicates. profiles.showcase_slots gained an array/length CHECK as the database backstop for the /api/account validation, which now also rejects a slug the member does not own — the column is public-read and its slugs are re-queried on every profile view, so an arbitrary string was both a data-quality and a query-shape problem.',
  '{"version": "visit-dedup-1.0"}'::jsonb
);
