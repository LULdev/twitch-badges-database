-- ============================================================
-- Twitch Badges Database — initial schema
-- Replaces any prior prototype tables (old project had zero
-- users; nothing to preserve).
-- ============================================================

create extension if not exists pgcrypto;

-- Explicit guard against a destructive replay (db-7). The `supabase_migrations`
-- ledger already skips applied files, but that is one process's bookkeeping: a
-- lost ledger, a hand-run psql replay or `supabase db push` against the wrong
-- project would hit the unconditional `drop table ... cascade` below and wipe
-- every badge, profile, inventory row and (through the FKs added in 0003) all
-- XP/coins/levels. The file therefore refuses to run once the catalog holds
-- rows. On a genuinely fresh database `public.badges` does not exist yet, so
-- the first apply is unaffected.
do $$
begin
  if to_regclass('public.badges') is not null then
    if exists (select 1 from public.badges limit 1) then
      raise exception
        'Refusing to re-apply 0001_init.sql: public.badges already holds % row(s). This migration DROPs the schema CASCADE and would destroy all user data.',
        (select count(*) from public.badges);
    end if;
  end if;
end $$;

-- Drop the previous prototype schema and this schema's own tables
-- (idempotent re-runs).
drop view if exists public.collector_stats;
drop table if exists
  public.user_webhooks,
  public.user_streaks,
  public.alert_rules,
  public.wishlists,
  public.comments,
  public.club_members,
  public.clubs,
  public.user_challenges,
  public.challenges,
  public.user_sync_state,
  public.user_inventory,
  public.push_subscriptions,
  public.notifications,
  public.changelog,
  public.blog_posts,
  public.badge_stats,
  public.badge_events,
  public.profiles,
  public.badges
  cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.touch_updated_at() cascade;
drop trigger if exists on_auth_user_created on auth.users;

-- ------------------------------------------------------------
-- Badges catalog
-- ------------------------------------------------------------
create table public.badges (
  id uuid primary key default gen_random_uuid(),
  set_id text not null,
  version text not null,
  slug text not null unique,
  title text not null,
  description text,
  image_url_1x text,
  image_url_2x text,
  image_url_4x text,
  click_url text,
  category text not null default 'events',
  is_paid boolean not null default false,
  how_to_earn text,
  start_date timestamptz,
  end_date timestamptz,
  release_date timestamptz,
  status text not null default 'active'
    check (status in ('active', 'upcoming', 'expired', 'removed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  source text not null default 'helix',
  -- denormalized latest potat stats (refreshed by sync:potat)
  owner_count bigint,
  active_count bigint,
  percentage numeric(8, 4),
  last_polled_at timestamptz,
  rarity_score int not null default 0,
  rarity_tier text not null default 'common'
    check (rarity_tier in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (set_id, version)
);

create index badges_status_idx on public.badges (status);
create index badges_end_date_idx on public.badges (end_date)
  where end_date is not null;
create index badges_start_date_idx on public.badges (start_date)
  where start_date is not null;
create index badges_category_idx on public.badges (category);
create index badges_is_paid_idx on public.badges (is_paid);
create index badges_rarity_tier_idx on public.badges (rarity_tier);
create index badges_rarity_score_idx on public.badges (rarity_score desc);
create index badges_owner_count_idx on public.badges (owner_count desc nulls last);
create index badges_first_seen_idx on public.badges (first_seen_at desc);

-- ------------------------------------------------------------
-- Stats time series (potat, every 15 min)
-- ------------------------------------------------------------
create table public.badge_stats (
  id bigint generated always as identity primary key,
  badge_id uuid not null references public.badges (id) on delete cascade,
  owner_count bigint,
  active_count bigint,
  percentage numeric(8, 4),
  polled_at timestamptz not null default now()
);

create index badge_stats_badge_polled_idx
  on public.badge_stats (badge_id, polled_at desc);

-- ------------------------------------------------------------
-- Badge history events
-- ------------------------------------------------------------
create table public.badge_events (
  id bigint generated always as identity primary key,
  badge_id uuid not null references public.badges (id) on delete cascade,
  kind text not null check (kind in ('added', 'updated', 'removed', 'restocked')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index badge_events_badge_idx on public.badge_events (badge_id, created_at desc);

-- ------------------------------------------------------------
-- Profiles (email lives only in auth.users — never exposed here)
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text,
  twitch_id text unique,
  avatar_url text,
  bio text,
  color text,
  banner_url text,
  theme text not null default 'violet',
  showcase_slots jsonb not null default '[]'::jsonb,
  inventory_public boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile on first Twitch login.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := lower(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
      'user'
    )
  );
  base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
  if base_username = '' or length(base_username) < 3 then
    base_username := 'user' || substr(new.id::text, 1, 6);
  end if;

  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name, twitch_id, avatar_url)
  values (
    new.id,
    final_username,
    coalesce(new.raw_user_meta_data ->> 'preferred_username', final_username),
    nullif(new.raw_user_meta_data ->> 'provider_id', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- User inventory (badges owned, synced from perfil)
-- ------------------------------------------------------------
create table public.user_inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id uuid not null references public.badges (id) on delete cascade,
  source text not null default 'sync',
  acquired_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create index user_inventory_user_idx on public.user_inventory (user_id);
create index user_inventory_badge_idx on public.user_inventory (badge_id);

create table public.user_sync_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  owned_count int,
  snapshot jsonb,
  last_synced_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Blog & changelog
-- ------------------------------------------------------------
create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  content text not null,
  cover_url text,
  author text not null default 'Twitch Badges Database',
  status text not null default 'published' check (status in ('draft', 'published')),
  is_auto boolean not null default false,
  locale text not null default 'en',
  tags text[] not null default '{}',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_posts_published_idx on public.blog_posts (published_at desc)
  where status = 'published';

create table public.changelog (
  id bigint generated always as identity primary key,
  kind text not null check (
    kind in ('badge_added', 'badge_updated', 'badge_removed', 'data_sync', 'feature', 'bugfix', 'blog', 'push')
  ),
  title text not null,
  body text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index changelog_created_idx on public.changelog (created_at desc);
create index changelog_kind_idx on public.changelog (kind, created_at desc);

-- ------------------------------------------------------------
-- Notifications (in-app feed + web push subscriptions)
-- ------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  kind text not null,
  title text not null,
  body text,
  payload jsonb,
  url text,
  created_at timestamptz not null default now()
);

create index notifications_created_idx on public.notifications (created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists badges_touch_updated on public.badges;
create trigger badges_touch_updated before update on public.badges
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated on public.profiles;
create trigger profiles_touch_updated before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists blog_posts_touch_updated on public.blog_posts;
create trigger blog_posts_touch_updated before update on public.blog_posts
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Site collector leaderboard view
-- ------------------------------------------------------------
create or replace view public.collector_stats
with (security_invoker = true) as
select
  p.id as user_id,
  p.username,
  p.display_name,
  p.avatar_url,
  p.inventory_public,
  count(ui.badge_id)::int as badges_owned,
  max(ui.acquired_at) as last_acquired_at
from public.profiles p
left join public.user_inventory ui on ui.user_id = p.id
group by p.id;

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------

-- Catalog tables: public read, writes only via service role.
alter table public.badges enable row level security;
alter table public.badge_stats enable row level security;
alter table public.badge_events enable row level security;
alter table public.blog_posts enable row level security;
alter table public.changelog enable row level security;
alter table public.notifications enable row level security;

create policy "badges_public_read" on public.badges
  for select using (true);
create policy "badge_stats_public_read" on public.badge_stats
  for select using (true);
create policy "badge_events_public_read" on public.badge_events
  for select using (true);
create policy "blog_posts_public_read" on public.blog_posts
  for select using (status = 'published');
create policy "changelog_public_read" on public.changelog
  for select using (true);
create policy "notifications_public_read" on public.notifications
  for select using (true);

-- Profiles: public read (no email column exists), self-managed rows.
alter table public.profiles enable row level security;
create policy "profiles_public_read" on public.profiles
  for select using (true);
create policy "profiles_self_insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Inventory: visible to the owner, or publicly when the profile opts in.
alter table public.user_inventory enable row level security;
create policy "inventory_read" on public.user_inventory
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = user_inventory.user_id and p.inventory_public
    )
  );
create policy "inventory_self_insert" on public.user_inventory
  for insert with check (user_id = auth.uid());
create policy "inventory_self_delete" on public.user_inventory
  for delete using (user_id = auth.uid());

alter table public.user_sync_state enable row level security;
create policy "sync_state_self_all" on public.user_sync_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Push subscriptions: anonymous opt-in allowed; owners can clean up.
alter table public.push_subscriptions enable row level security;
create policy "push_insert" on public.push_subscriptions
  for insert with check (true);
create policy "push_self_read" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "push_self_delete" on public.push_subscriptions
  for delete using (user_id = auth.uid() or user_id is null);

-- ------------------------------------------------------------
-- Restrictive grants: API roles never mutate catalog/content tables.
-- ------------------------------------------------------------
revoke insert, update, delete on public.badges from anon, authenticated;
revoke insert, update, delete on public.badge_stats from anon, authenticated;
revoke insert, update, delete on public.badge_events from anon, authenticated;
revoke insert, update, delete on public.blog_posts from anon, authenticated;
revoke insert, update, delete on public.changelog from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
revoke delete, insert on public.profiles from anon, authenticated;
grant delete on public.user_inventory to authenticated;
grant select on public.collector_stats to anon, authenticated;

-- ------------------------------------------------------------
-- Seed content
-- ------------------------------------------------------------
insert into public.changelog (kind, title, body, payload) values
  (
    'feature',
    'Twitch Badges Database launched',
    'Initial release: global badge catalog synced from the Twitch API, countdown timers, rarity index, leaderboards, profiles, blog, changelog, desktop notifications and 10 languages.',
    '{"version": "0.1.0"}'::jsonb
  ),
  (
    'data_sync',
    'Data pipeline connected',
    'Catalog (Twitch Helix / IVR), drop windows (badgebase.de) and owner statistics (potat.app) wired up. Badges a user owns resolve live via badges.blog.',
    null
  );

insert into public.blog_posts (slug, title, excerpt, content, tags, is_auto) values
  (
    'welcome-to-twitch-badges-database',
    'Welcome to Twitch Badges Database',
    'Track every global Twitch badge: live drops, countdown timers, rarity and worldwide collector leaderboards.',
    'Welcome! This site tracks **every global Twitch badge** in real time.

## What you can do here

- **Live catalog** — every active badge, synced directly from the Twitch API, with countdown timers showing exactly when each limited badge expires.
- **Upcoming drops** — preview badges before they go live and see their release dates.
- **Rarity index** — every badge gets a proprietary rarity score built from owner counts, wear rates, claim windows and age.
- **Leaderboards** — compare collectors worldwide, browse the most-owned and rarest badges.
- **Your collection** — log in with Twitch to see the badges you own and the ones you''re still missing, and share your profile at /profile/username.
- **Notifications** — get a desktop notification the moment a new badge goes live.
- **Blog & changelog** — every new drop is announced on the blog, and every change to this site is logged automatically in the changelog.

The site is available in 11 languages and in dark and light themes.',
    '{"welcome", "meta"}',
    false
  );
