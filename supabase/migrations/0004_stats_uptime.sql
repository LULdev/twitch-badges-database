-- ============================================================
-- 0004 — statistics + uptime observability
--   system_heartbeats: one row per sync run / health check
--   stats_* views:     pre-aggregated reads for /stats
-- ============================================================

-- ------------------------------------------------------------
-- Heartbeats: every sync engine run and every /api/health ping
-- writes one row. The /stats page derives uptime, response
-- times and data freshness from this single table.
-- ------------------------------------------------------------
create table if not exists public.system_heartbeats (
  id bigint generated always as identity primary key,
  source text not null,
  status text not null default 'ok' check (status in ('ok', 'degraded', 'error')),
  duration_ms int,
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_heartbeats_source_idx
  on public.system_heartbeats (source, created_at desc);
create index if not exists system_heartbeats_created_idx
  on public.system_heartbeats (created_at desc);

alter table public.system_heartbeats enable row level security;

drop policy if exists "heartbeats_public_read" on public.system_heartbeats;
create policy "heartbeats_public_read" on public.system_heartbeats
  for select using (true);

-- Writes are service-role only (cron routes + scripts).
revoke insert, update, delete on public.system_heartbeats from anon, authenticated;

-- ------------------------------------------------------------
-- Views. They run with the owner's rights (security_invoker off)
-- so aggregates over RLS-protected tables are complete, and they
-- expose ONLY aggregates / non-sensitive profile columns
-- (never profiles.email).
-- ------------------------------------------------------------

-- XP / BadgesCoins / activity totals in a single row.
create or replace view public.stats_gamification
with (security_invoker = off) as
select
  count(*)::bigint as players,
  coalesce(sum(xp), 0)::bigint as total_xp,
  coalesce(sum(coins), 0)::bigint as total_coins,
  coalesce(sum(coins_won), 0)::bigint as coins_won,
  coalesce(sum(coins_lost), 0)::bigint as coins_lost,
  coalesce(sum(games_played), 0)::bigint as games_played,
  coalesce(sum(games_won), 0)::bigint as games_won,
  coalesce(sum(wheel_spins), 0)::bigint as wheel_spins,
  coalesce(sum(steals_successful), 0)::bigint as steals_successful,
  coalesce(sum(steals_failed), 0)::bigint as steals_failed,
  coalesce(sum(times_robbed), 0)::bigint as times_robbed,
  coalesce(sum(achievements_points), 0)::bigint as achievement_points,
  coalesce(round(avg(level)::numeric, 2), 0)::numeric(10, 2) as avg_level,
  coalesce(max(level), 0)::int as max_level,
  (count(*) filter (where last_login_date >= current_date - 1))::bigint as active_1d,
  (count(*) filter (where last_login_date >= current_date - 7))::bigint as active_7d,
  (count(*) filter (where last_login_date >= current_date - 30))::bigint as active_30d,
  coalesce(max(updated_at), now()) as last_activity
from public.user_progress;

-- One row per level that is actually occupied (chart histograms).
create or replace view public.stats_levels
with (security_invoker = off) as
select
  level,
  count(*)::bigint as players,
  coalesce(sum(xp), 0)::bigint as xp,
  coalesce(sum(coins), 0)::bigint as coins
from public.user_progress
group by level
order by level;

-- Top collectors by XP (leaderboard teaser on /stats).
create or replace view public.stats_top_players
with (security_invoker = off) as
select
  p.username,
  p.avatar_url,
  pr.xp,
  pr.coins,
  pr.level,
  pr.games_played,
  pr.games_won,
  pr.achievements_points
from public.user_progress pr
join public.profiles p on p.id = pr.user_id
order by pr.xp desc
limit 20;

-- Per-game aggregates (plays, win rate, wagered volume, biggest win).
create or replace view public.stats_games
with (security_invoker = off) as
select
  game,
  count(*)::bigint as rounds,
  (count(*) filter (where won))::bigint as wins,
  coalesce(sum(bet), 0)::bigint as wagered,
  coalesce(sum(payout), 0)::bigint as paid_out,
  coalesce(max(payout), 0)::bigint as biggest_win,
  coalesce(max(bet), 0)::bigint as biggest_bet,
  count(distinct user_id)::bigint as players,
  max(created_at) as last_played
from public.game_rounds
group by game
order by rounds desc;

-- Biggest single wins, for the "hall of fame" strip.
create or replace view public.stats_biggest_wins
with (security_invoker = off) as
select
  gr.id,
  gr.game,
  gr.bet,
  gr.payout,
  gr.created_at,
  p.username,
  p.avatar_url
from public.game_rounds gr
join public.profiles p on p.id = gr.user_id
where gr.won
order by gr.payout desc
limit 10;

-- Daily XP / BadgesCoins flow for the trend chart (30 days).
create or replace view public.stats_daily_xp
with (security_invoker = off) as
select
  date_trunc('day', created_at)::date as day,
  count(*)::bigint as events,
  coalesce(sum(greatest(coalesce(xp_amount, 0), 0)), 0)::bigint as xp,
  coalesce(sum(coalesce(coins_amount, 0)), 0)::bigint as coins,
  count(distinct user_id)::bigint as players
from public.activity_events
where created_at >= current_date - interval '30 days'
group by 1
order by 1;

-- Feed activity grouped by kind: where do XP and BadgesCoins come from?
create or replace view public.stats_activity_kinds
with (security_invoker = off) as
select
  kind,
  count(*)::bigint as events,
  (count(*) filter (where created_at >= now() - interval '24 hours'))::bigint as events_24h,
  coalesce(sum(greatest(coalesce(xp_amount, 0), 0)), 0)::bigint as xp,
  coalesce(sum(coalesce(coins_amount, 0)), 0)::bigint as coins
from public.activity_events
group by kind
order by events desc;

-- Daily event volume (stacked area on /stats).
create or replace view public.stats_daily_activity
with (security_invoker = off) as
select
  date_trunc('day', created_at)::date as day,
  kind,
  count(*)::bigint as events
from public.activity_events
where created_at >= current_date - interval '30 days'
group by 1, 2
order by 1;

-- Achievement unlocks per achievement (rarest unlocks = lowest count).
create or replace view public.stats_achievements
with (security_invoker = off) as
select
  achievement_id,
  case
    when achievement_id like 'c\_%' then 'common'
    when achievement_id like 'k\_%' then 'creative'
    when achievement_id like 's\_%' then 'special'
    else 'other'
  end as category,
  count(*)::bigint as unlocks,
  count(distinct user_id)::bigint as players,
  min(unlocked_at) as first_unlock,
  max(unlocked_at) as last_unlock
from public.user_achievements
group by achievement_id
order by unlocks desc;

-- Steal-the-coins economy.
create or replace view public.stats_steals
with (security_invoker = off) as
select
  count(*)::bigint as attempts,
  (count(*) filter (where success))::bigint as successes,
  coalesce(sum(cost), 0)::bigint as cost_paid,
  coalesce(sum(coins) filter (where success), 0)::bigint as coins_stolen,
  coalesce(max(coins) filter (where success), 0)::bigint as biggest_steal,
  count(distinct thief_id)::bigint as thieves,
  count(distinct victim_id)::bigint as victims
from public.steal_attempts;

-- Wheel of fortune economy (spins, today's spins, turbo jackpots).
create or replace view public.stats_wheel
with (security_invoker = off) as
select
  (select coalesce(sum(wheel_spins), 0) from public.user_progress)::bigint as spins,
  (select count(*) from public.user_progress where last_wheel_date = current_date)::bigint as spins_today,
  (select count(*) from public.turbo_wins)::bigint as turbo_wins,
  (select count(*) from public.turbo_wins where delivered)::bigint as turbo_delivered;

-- Badge-claim and login economy (XP granted per feed kind).
create or replace view public.stats_badge_claims
with (security_invoker = off) as
select
  (select count(*) from public.activity_events where kind = 'badge_claim')::bigint as claims,
  (select count(distinct user_id) from public.activity_events where kind = 'badge_claim')::bigint as claimers,
  (select coalesce(sum(greatest(coalesce(xp_amount, 0), 0)), 0) from public.activity_events where kind = 'badge_claim')::bigint as claim_xp,
  (select count(*) from public.activity_events where kind = 'daily')::bigint as daily_claims,
  (select count(*) from public.activity_events where kind = 'coin_rain')::bigint as coin_rains;

-- Blog + profile traffic (views are 5-minute IP deduplicated).
create or replace view public.stats_traffic
with (security_invoker = off) as
select
  (select count(*) from public.blog_posts)::bigint as blog_posts,
  (select count(*) from public.blog_posts where status = 'published')::bigint as blog_published,
  (select count(*) from public.blog_views)::bigint as blog_views,
  (select count(*) from public.blog_views where created_at >= current_date - interval '7 days')::bigint as blog_views_7d,
  (select count(*) from public.blog_reactions)::bigint as blog_reactions,
  (select count(*) from public.profile_visits)::bigint as profile_visits,
  (select count(*) from public.profile_visits where created_at >= current_date - interval '7 days')::bigint as profile_visits_7d,
  (select coalesce(sum(view_count), 0) from public.profiles)::bigint as profile_views_total;

-- Raw table sizes — proof that the pipeline is alive.
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
  (select max(published_at) from public.blog_posts) as last_post;

-- New signups per day (30 days) — user growth chart.
create or replace view public.stats_daily_users
with (security_invoker = off) as
select
  date_trunc('day', created_at)::date as day,
  count(*)::bigint as signups
from public.profiles
where created_at >= current_date - interval '30 days'
group by 1
order by 1;

-- New catalog badges per day (30 days) — catalog growth chart.
create or replace view public.stats_daily_badges
with (security_invoker = off) as
select
  date_trunc('day', first_seen_at)::date as day,
  count(*)::bigint as badges,
  (count(*) filter (where is_paid))::bigint as paid
from public.badges
where first_seen_at >= current_date - interval '30 days'
group by 1
order by 1;

-- ------------------------------------------------------------
-- Uptime: per source (lifetime + 24h/7d/30d windows)
-- ------------------------------------------------------------
create or replace view public.stats_uptime_sources
with (security_invoker = off) as
select
  source,
  count(*)::bigint as checks_total,
  (count(*) filter (where status = 'ok'))::bigint as ok_total,
  (count(*) filter (where status = 'error'))::bigint as error_total,
  (count(*) filter (where created_at >= now() - interval '24 hours'))::bigint as checks_24h,
  (count(*) filter (where status = 'ok' and created_at >= now() - interval '24 hours'))::bigint as ok_24h,
  (count(*) filter (where created_at >= now() - interval '7 days'))::bigint as checks_7d,
  (count(*) filter (where status = 'ok' and created_at >= now() - interval '7 days'))::bigint as ok_7d,
  (count(*) filter (where created_at >= now() - interval '30 days'))::bigint as checks_30d,
  (count(*) filter (where status = 'ok' and created_at >= now() - interval '30 days'))::bigint as ok_30d,
  round(avg(duration_ms) filter (where created_at >= now() - interval '24 hours'))::int as avg_ms_24h,
  max(duration_ms)::int as max_ms,
  (array_agg(status order by created_at desc))[1] as last_status,
  (array_agg(message order by created_at desc))[1] as last_message,
  (array_agg(duration_ms order by created_at desc))[1] as last_ms,
  max(created_at) as last_at,
  min(created_at) as first_at
from public.system_heartbeats
group by source
order by source;

-- One row per day × source for the 30-day uptime calendar.
create or replace view public.stats_uptime_daily
with (security_invoker = off) as
select
  date_trunc('day', created_at)::date as day,
  source,
  count(*)::bigint as checks,
  (count(*) filter (where status = 'ok'))::bigint as ok,
  (count(*) filter (where status = 'error'))::bigint as errors,
  round(avg(duration_ms))::int as avg_ms
from public.system_heartbeats
where created_at >= current_date - interval '30 days'
group by 1, 2
order by 1;

-- Hourly strip for the last 48 hours (live availability bar).
create or replace view public.stats_uptime_hourly
with (security_invoker = off) as
select
  date_trunc('hour', created_at) as hour,
  count(*)::bigint as checks,
  (count(*) filter (where status = 'ok'))::bigint as ok
from public.system_heartbeats
where created_at >= now() - interval '48 hours'
group by 1
order by 1;

-- ------------------------------------------------------------
-- Grants: public read for every stats view
-- ------------------------------------------------------------
grant select on public.stats_gamification to anon, authenticated;
grant select on public.stats_levels to anon, authenticated;
grant select on public.stats_top_players to anon, authenticated;
grant select on public.stats_games to anon, authenticated;
grant select on public.stats_biggest_wins to anon, authenticated;
grant select on public.stats_daily_xp to anon, authenticated;
grant select on public.stats_activity_kinds to anon, authenticated;
grant select on public.stats_daily_activity to anon, authenticated;
grant select on public.stats_achievements to anon, authenticated;
grant select on public.stats_steals to anon, authenticated;
grant select on public.stats_wheel to anon, authenticated;
grant select on public.stats_badge_claims to anon, authenticated;
grant select on public.stats_traffic to anon, authenticated;
grant select on public.stats_system to anon, authenticated;
grant select on public.stats_daily_users to anon, authenticated;
grant select on public.stats_daily_badges to anon, authenticated;
grant select on public.stats_uptime_sources to anon, authenticated;
grant select on public.stats_uptime_daily to anon, authenticated;
grant select on public.stats_uptime_hourly to anon, authenticated;

-- PostgREST must see the new views immediately.
notify pgrst, 'reload schema';

-- Seed changelog entry for the feature drop.
insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Statistics page: XP, BadgesCoins, games and server uptime',
  'New /stats dashboard with animated charts: XP and BadgesCoins in circulation, level distribution, per-game win rates, achievement unlocks, steal and wheel economy, catalog growth, blog/profile traffic — plus a full uptime section backed by the new system_heartbeats table (per-source success rate for 24h/7d/30d, average run duration, 30-day availability calendar and a live /api/health ping).',
  '{"version": "stats-1.0"}'::jsonb
);
