-- ============================================================
-- CRITICAL: profiles.role was client-writable.
--
-- `protect_profile_columns()` (migration 0006) restores the columns a member must
-- not set on their own row when a session is present:
--
--     new.id, new.is_admin, new.view_count, new.twitch_id, new.created_at
--
-- Migration 0025 added `profiles.role` and never extended that list. The result
-- was a complete authorization bypass with one REST call, available to any
-- signed-in member:
--
--     PATCH /rest/v1/profiles?id=eq.<own id>   { "role": "owner" }
--
--   * `authenticated` holds column UPDATE privilege on `role`, and the only
--     UPDATE policy (`profiles_self_update`) matches `auth.uid() = id`, so the
--     caller's own row is writable;
--   * the guard did not restore `role`, so the write stood;
--   * `sync_is_admin` then set `is_admin := true` off the new role;
--   * `viewerRole()` authorizes on `role` alone, so the caller became an owner in
--     every `/api/admin/**` route — able to demote or delete the real owner,
--     since the owner-protection rail only guards non-owner actors.
--
-- The guard is the right place to fix it: the service role used by the panel and
-- the bootstrap flow has no `auth.uid()`, so it bypasses this function and keeps
-- writing roles, exactly as intended.
--
-- The same class of bug had already been fixed once for `is_admin`, which is why
-- the guard exists at all.
-- ============================================================

create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.id := old.id;
    new.is_admin := old.is_admin;
    -- `role` decides who may use the admin panel. Leaving it writable let any
    -- member promote themselves to owner. Service-role writes (the panel, the
    -- bootstrap flow) carry no auth.uid() and pass through untouched.
    new.role := old.role;
    new.view_count := old.view_count;
    new.twitch_id := old.twitch_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- The guard makes `update profiles set is_admin = true` a no-op for a session,
-- which is correct — but migration 0025 never backfilled `role` from `is_admin`,
-- so an admin predating the ACP would keep `role = 'user'` and lose the panel
-- with no way to be repaired by the trigger (its WHEN clause needs a *change*).
-- No row is affected today; this keeps a from-scratch apply correct.
update public.profiles
   set role = 'owner'
 where is_admin is true
   and role = 'user';

-- ============================================================
-- Visitor analytics: the detailed views are not public.
--
-- Only `stats_analytics_summary` fields are rendered on /stats. The other five
-- were nevertheless granted to anon, so `top_paths` published the raw path column
-- — including `/xx/profile/<username>` URLs — and `referrers` published referring
-- hosts, to anyone with the publishable key. The panel reads them with the
-- service role now (src/lib/analytics.ts), so the anon grant is pure exposure.
-- ============================================================

revoke all on public.stats_analytics_summary from anon, authenticated;
revoke all on public.stats_analytics_daily from anon, authenticated;
revoke all on public.stats_analytics_top_paths from anon, authenticated;
revoke all on public.stats_analytics_top_referrers from anon, authenticated;
revoke all on public.stats_analytics_clients from anon, authenticated;
revoke all on public.stats_analytics_locales from anon, authenticated;

-- ============================================================
-- The beacon's documented bounds belong in the table, not only in JavaScript.
-- /api/track clamps path length, screen width, timezone offset and duration; a
-- CHECK constraint means a future writer (or the service role from a script)
-- cannot store a value outside those bounds either.
-- ============================================================

alter table public.analytics_events
  add constraint analytics_events_path_len check (char_length(path) <= 200),
  add constraint analytics_events_locale_len check (char_length(locale) <= 8),
  add constraint analytics_events_referrer_len check (char_length(referrer_host) <= 120),
  add constraint analytics_events_screen_w_range check (screen_w is null or (screen_w >= 0 and screen_w <= 10000)),
  add constraint analytics_events_tz_range check (tz_offset_mins is null or (tz_offset_mins >= -1440 and tz_offset_mins <= 1440)),
  add constraint analytics_events_duration_range check (duration_s is null or (duration_s >= 0 and duration_s <= 86400));

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Critical: any signed-in member could make themselves owner through the public REST API',
  'Migration 0025 added profiles.role but did not extend protect_profile_columns(), the guard that restores the columns a member must not set on their own row. Because authenticated held UPDATE on the role column, the only UPDATE policy matches the caller own row, and viewerRole() authorizes on role alone, a single PATCH to /rest/v1/profiles with {"role":"owner"} gave any signed-in member every admin route — including the power to demote or delete the real owner, since the owner-protection rail only stops non-owner actors. The guard now restores role as well; the service role used by the panel and the bootstrap flow carries no auth.uid() and is unaffected. The same migration also stops granting the five detailed visitor-analytics views to anon (they were never rendered publicly but published raw page paths and referring hosts), moves the panel reads of them to the service role, puts the beacon documented bounds into CHECK constraints on analytics_events, and backfills role from is_admin for any admin predating the ACP.',
  '{"version": "acp-security-2.0", "severity": "critical"}'::jsonb
);

notify pgrst, 'reload schema';