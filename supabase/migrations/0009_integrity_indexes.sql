-- ============================================================
-- 0009 — integrity constraints, indexes and a narrower public read
-- ============================================================

-- 1) The economy assumes these invariants everywhere in the application code
--    (award() clamps, resolveStatus ignores negatives). Stating them in the
--    database means a future bug cannot silently store an impossible value.
alter table public.user_progress
  drop constraint if exists user_progress_xp_non_negative;
alter table public.user_progress
  add constraint user_progress_xp_non_negative check (xp >= 0);

alter table public.user_progress
  drop constraint if exists user_progress_coins_non_negative;
alter table public.user_progress
  add constraint user_progress_coins_non_negative check (coins >= 0);

alter table public.user_progress
  drop constraint if exists user_progress_level_range;
alter table public.user_progress
  add constraint user_progress_level_range check (level between 1 and 100);

alter table public.user_progress
  drop constraint if exists user_progress_streak_non_negative;
alter table public.user_progress
  add constraint user_progress_streak_non_negative
  check (login_streak >= 0 and best_login_streak >= 0);

alter table public.profiles
  drop constraint if exists profiles_view_count_non_negative;
alter table public.profiles
  add constraint profiles_view_count_non_negative check (view_count >= 0);

alter table public.badges
  drop constraint if exists badges_rarity_score_range;
alter table public.badges
  add constraint badges_rarity_score_range
  check (rarity_score is null or (rarity_score >= 0 and rarity_score <= 100));

-- 2) The feed API and two stats views filter/group by `kind`, and the profile
--    visit queries scan by (profile, time). Both had no supporting index.
create index if not exists activity_events_kind_idx
  on public.activity_events (kind, created_at desc);

create index if not exists profile_visits_visitor_idx
  on public.profile_visits (visitor_id, created_at desc)
  where visitor_id is not null;

-- 3) Column-hardening the public read path
--    `profiles` is public-read by design (the profile page is public), but
--    `twitch_id` and `potat_connections` are account-identity data that no
--    public page renders. Column-level SELECT grants express that: the app's
--    own profile queries use the anon/authenticated client, scripts and cron
--    use the service role and are unaffected.
revoke select on public.profiles from anon, authenticated;
grant select (
  id, username, display_name, avatar_url, bio, color, banner_url, theme,
  showcase_slots, inventory_public, created_at, updated_at, customization,
  view_count, steal_enabled, steal_price, steal_max, mood,
  potat_level, potatoes, potat_first_seen, twitch_created_at
) on public.profiles to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Database integrity: CHECK constraints, missing indexes, narrower profile read',
  'The application enforces non-negative XP/coins, a level between 1 and 100, non-negative view counts and a 0-100 rarity score in code only; these are now CHECK constraints, so a future bug cannot store an impossible value. Added the missing indexes for the feed API and stats views (activity_events by kind) and for the visitor lookup (profile_visits by visitor). The public profile read no longer exposes twitch_id or potat_connections: SELECT is granted per column for anon/authenticated, while scripts and cron keep the service role.',
  '{"version": "integrity-1.0"}'::jsonb
);