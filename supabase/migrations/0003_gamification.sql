-- ============================================================
-- 0003 — gamification: XP/coins/levels, live feed, achievements,
--        games, steal, profile visitors, blog views + reactions
-- ============================================================

-- Per-user progress: XP, coins, level, streaks, daily gates, aggregates.
create table if not exists public.user_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  xp bigint not null default 0,
  coins bigint not null default 0,
  level int not null default 1,
  login_streak int not null default 0,
  best_login_streak int not null default 0,
  last_login_date date,
  last_wheel_date date,
  games_played int not null default 0,
  games_won int not null default 0,
  coins_won bigint not null default 0,
  coins_lost bigint not null default 0,
  wheel_spins int not null default 0,
  steals_successful int not null default 0,
  steals_failed int not null default 0,
  times_robbed int not null default 0,
  game_xp_today int not null default 0,
  game_xp_day date,
  achievements_points int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ONE public live feed powering /feed: every XP gain, game, achievement,
-- steal, wheel spin, badge claim …
create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  username text,
  avatar_url text,
  kind text not null,
  title text not null,
  body text,
  xp_amount int,
  coins_amount bigint,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_created_idx
  on public.activity_events (created_at desc);
create index if not exists activity_events_user_idx
  on public.activity_events (user_id, created_at desc);

-- Achievement unlock ledger (catalog lives in code).
create table if not exists public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create index if not exists user_achievements_user_idx
  on public.user_achievements (user_id, unlocked_at desc);

-- Every played round (stats, anti-cheat audit, achievements).
create table if not exists public.game_rounds (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  game text not null,
  bet bigint not null default 0,
  payout bigint not null default 0,
  won boolean not null default false,
  result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists game_rounds_user_idx
  on public.game_rounds (user_id, created_at desc);
create index if not exists game_rounds_game_idx
  on public.game_rounds (game, created_at desc);

-- Steal-the-coins: attempts + flood check basis.
create table if not exists public.steal_attempts (
  id bigint generated always as identity primary key,
  thief_id uuid not null references public.profiles (id) on delete cascade,
  victim_id uuid not null references public.profiles (id) on delete cascade,
  cost bigint not null default 0,
  coins bigint not null default 0,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists steal_attempts_pair_idx
  on public.steal_attempts (thief_id, victim_id, created_at desc);
create index if not exists steal_attempts_victim_idx
  on public.steal_attempts (victim_id, created_at desc);

-- Profile visitors (5-minute IP dedup in the sync code).
create table if not exists public.profile_visits (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  visitor_id uuid references public.profiles (id) on delete set null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_visits_profile_idx
  on public.profile_visits (profile_id, created_at desc);
create index if not exists profile_visits_dedup_idx
  on public.profile_visits (profile_id, ip_hash, created_at desc);

-- Blog: view counter (5-minute IP dedup) + emoji reactions.
create table if not exists public.blog_views (
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists blog_views_dedup_idx
  on public.blog_views (post_id, ip_hash, created_at desc);

create table if not exists public.blog_reactions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  ip_hash text not null,
  emoji text not null check (emoji in ('like', 'love', 'laugh', 'fire', 'wow')),
  created_at timestamptz not null default now(),
  unique (post_id, ip_hash, emoji)
);

-- Turbo subscription jackpot wins (wheel of fortune).
create table if not exists public.turbo_wins (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

-- Profile customization (20 common + 15 creative settings) as one document.
alter table public.profiles
  add column if not exists customization jsonb not null default '{}'::jsonb,
  add column if not exists view_count int not null default 0,
  add column if not exists steal_enabled boolean not null default true,
  add column if not exists steal_price int not null default 100,
  add column if not exists steal_max int not null default 250,
  add column if not exists mood text;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.user_progress enable row level security;
alter table public.activity_events enable row level security;
alter table public.user_achievements enable row level security;
alter table public.game_rounds enable row level security;
alter table public.steal_attempts enable row level security;
alter table public.profile_visits enable row level security;
alter table public.blog_views enable row level security;
alter table public.blog_reactions enable row level security;
alter table public.turbo_wins enable row level security;

-- Public reads: the feed, leaderboards and profiles are open.
create policy "progress_public_read" on public.user_progress
  for select using (true);
create policy "activity_public_read" on public.activity_events
  for select using (true);
create policy "user_achievements_public_read" on public.user_achievements
  for select using (true);
create policy "game_rounds_public_read" on public.game_rounds
  for select using (true);
create policy "steals_public_read" on public.steal_attempts
  for select using (true);
create policy "profile_visits_owner_read" on public.profile_visits
  for select using (profile_id = auth.uid());
create policy "turbo_wins_public_read" on public.turbo_wins
  for select using (true);

create policy "blog_reactions_insert" on public.blog_reactions
  for insert with check (true);
create policy "blog_reactions_delete_own" on public.blog_reactions
  for delete using (user_id = auth.uid());
create policy "blog_views_insert" on public.blog_views
  for insert with check (true);

-- All writes flow through the service role (server routes/scripts only).
revoke insert, update, delete on public.user_progress from anon, authenticated;
revoke insert, update, delete on public.activity_events from anon, authenticated;
revoke insert, update, delete on public.user_achievements from anon, authenticated;
revoke insert, update, delete on public.game_rounds from anon, authenticated;
revoke insert, update, delete on public.steal_attempts from anon, authenticated;
revoke insert, update, delete on public.profile_visits from anon, authenticated;
revoke insert, update, delete on public.blog_views from anon, authenticated;
revoke delete on public.blog_reactions from anon;
revoke insert, update, delete on public.turbo_wins from anon, authenticated;

-- Seed changelog entry for the feature drop.
insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Gamification launch: XP, coins, levels, games and achievements',
  'Level 1–100 XP system with sparkle level badges, coin economy, public live activity feed, daily Wheel of Fortune (Twitch Turbo jackpot at 1:100,000,000), 125 achievements, 13 badge-themed games, coin stealing, profile customization and profile visitors.',
  '{"version": "gamification-1.0"}'::jsonb
);
