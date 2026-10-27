-- 0079 — stats_arcade_month_top widened from top 3 to top 10: the profile's
-- "#X of the month" chip needs the member's RANK, and ranks 4-10 are worth
-- showing too. Same SELECT as 0078 (never edit an applied migration — this
-- re-creates the view), same doctrine: security_invoker = off, username +
-- avatar_url only, explicit grant, deterministic order. Existing consumers
-- are unaffected: the hub podium's reader caps client-side at .limit(3).

create or replace view public.stats_arcade_month_top
with (security_invoker = off) as
select
  p.username,
  p.avatar_url,
  count(*)::bigint as rounds_30d,
  coalesce(sum(r.bet), 0)::bigint as wagered_30d
from public.game_rounds r
join public.profiles p on p.id = r.user_id
where r.created_at >= now() - interval '30 days'
group by p.username, p.avatar_url
order by rounds_30d desc, wagered_30d desc, p.username
limit 10;

grant select on public.stats_arcade_month_top to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Month-top view widened to ten',
  'stats_arcade_month_top now serves the trailing-30-day top 10 by settled rounds (was 3) so profiles can show a member''s month rank; the games hub podium keeps reading only the top 3.',
  '{"version": "0079-1.0", "view": "stats_arcade_month_top", "top": 10, "window": "30d rolling"}'::jsonb
);

notify pgrst, 'reload schema';
