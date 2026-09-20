-- ============================================================
-- 0002 — status truth, rarity inputs, potat profile data
-- ============================================================

-- Only badges confirmed currently-redeemable (badgebase /active list or a
-- live claim window) keep status 'active'; everything else becomes
-- 'expired'. Dateless badges need an explicit flag maintained by the
-- badgebase listing sync.
alter table public.badges
  add column if not exists is_confirmed_active boolean not null default false;

-- Profiles: potat.app user enrichment, filled after Twitch OAuth login.
alter table public.profiles
  add column if not exists twitch_created_at timestamptz,
  add column if not exists potat_level int,
  add column if not exists potatoes int,
  add column if not exists potat_first_seen timestamptz,
  add column if not exists potat_connections jsonb;

-- 24h active-user growth for limited-window badges (rarity momentum input).
create or replace view public.badge_momentum
with (security_invoker = true) as
select
  b.id as badge_id,
  b.active_count,
  b.active_count - coalesce(h.active_count, b.active_count) as growth_24h
from public.badges b
left join lateral (
  select s.active_count
  from public.badge_stats s
  where s.badge_id = b.id
    and s.polled_at <= now() - interval '20 hours'
  order by s.polled_at desc
  limit 1
) h on true
where b.end_date is not null
  and b.status <> 'removed';

grant select on public.badge_momentum to anon, authenticated;
