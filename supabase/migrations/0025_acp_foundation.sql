-- ============================================================
-- Admin Control Panel foundation (Phase 1 of the ACP build).
--
-- Everything here is service-role-write. The bootstrap passcode is
-- NOT stored anywhere in the database — only its salted digest
-- lives in the source (src/lib/admin.ts), and the whole passcode
-- path disappears once an owner is registered in site_settings.
-- ============================================================

-- 1) Site settings: key/value store the admin dashboard owns.
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
create policy "settings_public_read" on public.site_settings
  for select using (true);

insert into public.site_settings (key, value) values
  ('maintenance', '{"enabled": false, "message": ""}'),
  ('features', '{"feed": true, "wheel": true, "steals": true, "coinRain": true, "compare": true, "games": true}')
on conflict (key) do nothing;

-- 2) Roles on profiles. is_admin stays as the compatibility flag and is
--    kept in sync by the trigger below (owner/admin -> true).
alter table public.profiles
  add column role text not null default 'user'
  check (role in ('user', 'moderator', 'admin', 'owner'));

create or replace function public.sync_is_admin() returns trigger
language plpgsql as $$
begin
  if new.role in ('admin', 'owner') then
    new.is_admin := true;
  else
    new.is_admin := false;
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_is_admin on public.profiles;
create trigger profiles_sync_is_admin before update on public.profiles
  for each row
  when (new.role is distinct from old.role or new.is_admin is distinct from old.is_admin)
  execute function public.sync_is_admin();

-- 3) Bans. A ban blocks login-protected surfaces; banned_until null = permanent.
create table if not exists public.bans (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  reason text not null default '',
  banned_by uuid references public.profiles (id) on delete set null,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bans enable row level security;
create policy "bans_owner_read" on public.bans
  for select using (profile_id = auth.uid());

-- 4) Newsletter drafts (sending status + recipients audited).
create table if not exists public.newsletter_drafts (
  id bigint generated always as identity primary key,
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'sent')),
  channel text not null default 'push' check (channel in ('push', 'email', 'both')),
  recipient_count int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.newsletter_drafts enable row level security;

-- 5) Brainstorm board, publicly readable, service-role writable.
create table if not exists public.brainstorm_ideas (
  id bigint generated always as identity primary key,
  category text not null check (category in ('profile', 'game', 'badge', 'design', 'content', 'stats', 'other')),
  title text not null,
  body text not null default '',
  status text not null default 'idea' check (status in ('idea', 'planned', 'done', 'rejected')),
  votes int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.brainstorm_ideas enable row level security;
create policy "brainstorm_public_read" on public.brainstorm_ideas
  for select using (true);

-- 6) Audit trail for every admin mutation.
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor text not null default 'bootstrap',
  action text not null,
  target text not null default '',
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
create policy "audit_owner_read" on public.admin_audit
  for select using (actor_id = auth.uid());

-- 7) Analytics events. Written by an anonymous beacon (/api/track):
--    no IP is stored, only a salted visitor hash for the online count.
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  path text not null default '',
  locale text not null default '',
  referrer_host text not null default '',
  visitor_hash text not null default '',
  browser text not null default '',
  os text not null default '',
  device text not null default '',
  screen_w int,
  tz_offset_mins int,
  duration_s int
);
alter table public.analytics_events enable row level security;
create policy "analytics_anon_insert" on public.analytics_events
  for insert with check (true);
create index analytics_events_ts_idx on public.analytics_events (ts desc);
create index analytics_events_visitor_idx on public.analytics_events (visitor_hash, ts desc);

-- 8) Aggregates over the analytics table. security_invoker = off so the
--    public stats page can read complete aggregates, same contract as the
--    stats_* views in 0004.
create or replace view public.stats_analytics_summary with (security_invoker = off) as
select
  (select count(*) from public.analytics_events)::bigint as total_hits,
  (select count(distinct visitor_hash) from public.analytics_events where visitor_hash <> '')::bigint as unique_visitors,
  (select count(*) from public.analytics_events where ts > now() - interval '1 day')::bigint as hits_24h,
  (select count(*) from public.analytics_events where ts > now() - interval '7 days')::bigint as hits_7d,
  (select count(*) from public.analytics_events where ts > now() - interval '30 days')::bigint as hits_30d,
  (select count(*) from public.analytics_events where ts > now() - interval '90 days')::bigint as hits_90d,
  (select count(distinct visitor_hash) from public.analytics_events
     where visitor_hash <> '' and ts > now() - interval '5 minutes')::bigint as online_now,
  (select coalesce(round(avg(duration_s), 1), 0) from public.analytics_events
     where duration_s is not null and ts > now() - interval '30 days')::numeric as avg_duration_s;

create or replace view public.stats_analytics_daily with (security_invoker = off) as
select date_trunc('day', ts)::date as day,
       count(*)::bigint as hits,
       count(distinct visitor_hash)::bigint as visitors
  from public.analytics_events
 where ts > now() - interval '90 days'
 group by 1 order by 1;

create or replace view public.stats_analytics_top_paths with (security_invoker = off) as
select path, count(*)::bigint as hits
  from public.analytics_events
 where ts > now() - interval '30 days' and path <> ''
 group by path order by hits desc limit 25;

create or replace view public.stats_analytics_top_referrers with (security_invoker = off) as
select referrer_host, count(*)::bigint as hits
  from public.analytics_events
 where ts > now() - interval '30 days' and referrer_host <> ''
 group by referrer_host order by hits desc limit 25;

create or replace view public.stats_analytics_clients with (security_invoker = off) as
select browser, os, device, count(*)::bigint as hits
  from public.analytics_events
 where ts > now() - interval '30 days'
 group by browser, os, device order by hits desc limit 50;

create or replace view public.stats_analytics_locales with (security_invoker = off) as
select locale, count(*)::bigint as hits
  from public.analytics_events
 where ts > now() - interval '30 days' and locale <> ''
 group by locale order by hits desc limit 25;

grant select on public.stats_analytics_summary,
                public.stats_analytics_daily,
                public.stats_analytics_top_paths,
                public.stats_analytics_top_referrers,
                public.stats_analytics_clients,
                public.stats_analytics_locales
  to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Admin Control Panel: database foundation for roles, settings, bans, analytics and more',
  'Migration 0025 lays the groundwork for the admin dashboard: a site_settings key/value store (maintenance mode, feature flags, economy values), a four-level role column on profiles kept in sync with is_admin by a trigger, a bans table, newsletter drafts, a publicly readable brainstorm board, an audit trail for every admin mutation, and an analytics table fed by an anonymous beacon (salted visitor hash, no IP) with six aggregate views for today/7d/30d/90d hits, unique visitors, online-now, top paths, referrers, client classes and locales. Everything is service-role-write; reads go through RLS or the aggregate views.',
  '{"version": "acp-foundation-1.0"}'::jsonb
);

notify pgrst, 'reload schema';