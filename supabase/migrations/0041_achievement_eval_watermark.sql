-- ============================================================
-- 0041 — a per-user watermark so a redundant achievement pass can be skipped
-- ============================================================
-- WHY THIS EXISTS
-- `evaluateAchievements()` (src/lib/gamification/achievements.ts) issues ~20
-- service-role queries per call: seven paged aggregates over tables that grow
-- without bound (user_inventory, game_rounds, activity_events, steal_attempts,
-- profile_visits) plus a dozen single-row reads. It is called from every
-- `award()` without `skipAchievements`, and additionally at the end of every
-- game round (games.ts), the daily/heist/rain paths and the wheel. A single
-- round therefore paid the full ~20-request pass.
--
-- Almost all of those calls follow an action that changed nothing any of the
-- 125 checks reads: the same user plays another round, the profile page
-- re-renders, a leaderboard polls. The predicates in ACHIEVEMENTS are pure
-- functions of two things:
--
--   (a) the rows in a fixed set of tables, and
--   (b) the wall clock.
--
-- (a) is observable in ONE round trip. This migration moves the "newest thing
-- that could change an achievement" question into a single SQL function, and
-- stores the answer to "what had the last COMPLETE pass already seen" in a
-- dedicated row. A re-run is skipped only when no source row is newer than
-- that instant, so a skipped pass provably cannot hide a data-driven unlock.
-- (b) cannot be observed, so the skip is additionally bounded by a wall-clock
-- window: ACH_EVAL_SKIP_WINDOW_MS in achievements.ts forces a full pass at
-- least once per window, which is what keeps the clock-dependent checks
-- (`k_weekend_warrior` reads getUTCDay(), `s_birthday` compares today's month
-- and day with the Twitch account's creation date, `s_ghost_town` reads
-- accountAgeDays, which grows with no row changing) from being starved.
--
-- TWO CHECKS SIT OUTSIDE THE WATERMARK ON PURPOSE. `s_top_percent` reads the
-- top-3 coin balances across ALL users and `s_pioneer` counts total profiles,
-- so both change when a DIFFERENT user acts — a row this per-user query cannot
-- see. They are therefore deferred by up to one skip window rather than being
-- exact. Watching them would mean scanning those tables globally on every
-- call, which is precisely the cost the fast path exists to remove; a deferral
-- bounded by the window is the acceptable trade for two special achievements.
--
-- WHY A DEDICATED TABLE AND NOT A COLUMN ON `user_progress`
-- Two traps, both load-bearing:
--
--   1. `award()` (src/lib/gamification/xp.ts) rebuilds its UPDATE payload as
--      `{ ...rest, level, updated_at }` where `rest` is `user_progress` MINUS a
--      hand-maintained destructure list. A watermark column added there is not
--      in that list, so every award would write a stale watermark back over the
--      fresh one — silently re-arming the fast path forever. The comment above
--      it already warns about exactly this class of bug.
--   2. The ledger row for a pass must record the instant the pass's READS
--      covered, not the instant it finished. Writing now() would race every
--      commit that lands mid-pass. A separate table is also not read by
--      `getProgress()` (`select *` on user_progress), so the two concerns
--      cannot interfere at all.
--
-- Column `inputs_at` is the newest source row the last COMPLETED pass had
-- already seen when it STARTED. NULL/absent row means "never evaluated" and the
-- fast path is off, which is also the fail-safe direction: an unarmed fast path
-- is recoverable, an armed-and-wrong one is not.

create table if not exists public.user_achievement_eval (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Stored as read, never as now(): a commit that lands mid-pass carries a
  -- later timestamp and therefore forces the next call to run in full.
  inputs_at timestamptz not null,
  evaluated_at timestamptz not null default now()
);

comment on column public.user_achievement_eval.inputs_at is
  'Newest achievement-relevant source row the last completed evaluateAchievements() pass had already seen when it started. NULL table row = fast path disabled.';

alter table public.user_achievement_eval enable row level security;

-- The platform default ACL hands anon/authenticated full DML on every new
-- table in public (this is the shape 0037 swept). This table is a private
-- scheduler detail: service role only, and no policy, so the API roles hit
-- 42501 rather than reading it.
revoke all on public.user_achievement_eval from anon, authenticated;

-- 1) The fast path must be ONE round trip: the recomputed input watermark and
--    the stored ledger row come back together, so a skip decision costs a
--    single request instead of twenty.
--
--    Every table a check in ACHIEVEMENTS reads, with the column that moves when
--    a value it depends on changes:
--      user_progress     -> all progress.* counters   (updated_at; every writer
--                           sets it. add_coins/apply_xp_coins in 0006,
--                           bump_counters/gates in 0007, the pair RPC in 0015,
--                           consume_and_apply_game_xp in 0017, the level patch
--                           in award(). The one statement that does NOT set it
--                           is the `best_login_streak` follow-up inside
--                           claim_daily_gate (0007), which runs in the SAME
--                           transaction as the statement that does — now() is
--                           the transaction timestamp, so both carry the same
--                           value and the change is still observed.)
--      user_inventory    -> badgesOwned, tiers, rarity  (acquired_at)
--      game_rounds       -> gamesByType, streaks, hat-trick, max recent round
--                          (created_at; appended only)
--      activity_events   -> wheelBest, rains, dailyCount, activityCount,
--                           lastDailyHour (created_at; appended only)
--      turbo_wins        -> turboWins                  (created_at)
--      profiles          -> view_count, customization, mood, showcase_slots,
--                           twitch_created_at, accountAgeDays
--                           (updated_at; unconditional touch trigger, 0001)
--      steal_attempts    -> steals, defendedCount, stealCostPaid
--      profile_visits    -> profileViews, visitorsCount, profilesVisited
--      blog_reactions    -> reactionsGiven             (created_at)
--      user_achievements -> the `unlocked` set AND the meta-achievement count
--                           (unlocked_at). Deliberately included: this pass
--                           inserts rows, and an insert here must force the
--                           NEXT call to run so c_ach_1/c_ach_10 resolve.
--      badges            -> activeOwned, expiredOwned, legendaryOwned, mythic
--                           Owned, bestBadgeScore, hasTwitchcon. This is a
--                           GLOBAL max, not a per-user one, so a catalog sync
--                           invalidates every user's watermark at once. That is
--                           correct rather than wasteful: exactly one full pass
--                           per user is needed after a sync, and that pass
--                           re-arms the watermark.
create or replace function public.achievement_eval_state(p_user_id uuid)
returns table (inputs_at timestamptz, stored_inputs_at timestamptz, evaluated_at timestamptz)
language sql
stable
set search_path = public
as $$
  with newest as (
    select greatest(
      coalesce((select max(updated_at)    from public.user_progress    where user_id       = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(acquired_at)   from public.user_inventory   where user_id       = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(created_at)    from public.game_rounds      where user_id       = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(created_at)    from public.activity_events  where user_id       = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(created_at)    from public.turbo_wins       where user_id       = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(updated_at)    from public.profiles         where id            = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(created_at)    from public.steal_attempts   where thief_id     = p_user_id or victim_id  = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(created_at)    from public.profile_visits   where profile_id   = p_user_id or visitor_id = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(created_at)    from public.blog_reactions   where user_id       = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(unlocked_at)   from public.user_achievements where user_id      = p_user_id), '-infinity'::timestamptz),
      coalesce((select max(updated_at)    from public.badges), '-infinity'::timestamptz)
    ) as ts
  )
  select
    case when newest.ts = '-infinity'::timestamptz then null else newest.ts end as inputs_at,
    -- The value the last COMPLETE pass had already seen when it STARTED. The
    -- skip decision must compare the fresh recompute against THIS, never
    -- against evaluated_at: comparing against the finish time would also skip
    -- a row committed while that pass was still working (its timestamp sits
    -- between inputs_at and evaluated_at), which would hide a genuine unlock.
    w.inputs_at as stored_inputs_at,
    w.evaluated_at
  from newest
  left join public.user_achievement_eval w on w.user_id = p_user_id;
$$;

-- 2) Arm the fast path. Called ONCE, at the end of a pass that ran in full,
--    with the inputs_at that pass's own read had already observed.
create or replace function public.bump_achievement_eval_watermark(
  p_user_id uuid,
  p_inputs_at timestamptz
)
returns void
language sql
volatile
set search_path = public
as $$
  insert into public.user_achievement_eval (user_id, inputs_at, evaluated_at)
  values (p_user_id, p_inputs_at, now())
  on conflict (user_id) do update
     set inputs_at    = excluded.inputs_at,
         evaluated_at = excluded.evaluated_at;
$$;

-- Supporting indexes for the max() probes above. game_rounds, profile_visits
-- (both directions), user_achievements and activity_events already carry a
-- leading user_id/first-column index from 0003/0009/0016; these two did not, and
-- both are scanned once per evaluateAchievements() call.
create index if not exists user_inventory_acquired_idx
  on public.user_inventory (user_id, acquired_at desc);
create index if not exists blog_reactions_user_idx
  on public.blog_reactions (user_id, created_at desc)
  where user_id is not null;

-- The service role is the only caller. Default privileges give PUBLIC EXECUTE
-- on every new function (revoked for the API roles in 0037, not for PUBLIC), so
-- both are closed explicitly, following 0006.
revoke all on function public.achievement_eval_state(uuid) from public;
grant execute on function public.achievement_eval_state(uuid) to service_role;
revoke all on function public.bump_achievement_eval_watermark(uuid, timestamptz) from public;
grant execute on function public.bump_achievement_eval_watermark(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Achievement evaluation gets a per-user watermark and a provably safe fast path',
  'evaluateAchievements() runs about twenty service-role queries per call — seven of them paged aggregates over tables that grow without bound — and it is invoked by every award(), by every game round, by the daily, heist and coin-rain paths and by the wheel. Nearly all of those calls follow an action that changed nothing any of the 125 checks reads. This migration adds user_achievement_eval, a per-user ledger row holding inputs_at (the newest achievement-relevant source row the last completed pass had already seen when it began) and evaluated_at, plus achievement_eval_state(), which recomputes the newest input across user_progress, user_inventory, game_rounds, activity_events, turbo_wins, profiles, steal_attempts, profile_visits, blog_reactions, user_achievements and the badge catalog and returns it together with the stored ledger in a single round trip. A re-run is skipped only when no source row is newer than inputs_at, which means the pass provably saw every row it is being told to skip, and the skip additionally expires after a wall-clock window so the checks that depend on the clock rather than on data — weekend rollover, the Twitch anniversary, the seven-day ghost-town window — still resolve on schedule. The ledger is a dedicated table rather than a user_progress column on purpose: award() rebuilds its UPDATE payload from a user_progress snapshot minus a hand-maintained exclusion list, so a new column there would be written back stale and permanently disarm the fast path.',
  '{"version": "achievement-eval-watermark-1.0"}'::jsonb
);
