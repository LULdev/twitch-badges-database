-- 0077 — stats_arcade_month v2: the prior-month columns for the community
-- banner's trend clause. New columns APPENDED at the end of the projection so
-- CREATE OR REPLACE VIEW stays compatible and the existing grant survives
-- (the 0064 convention). Two window slices over game_rounds: the current 30
-- days and the 30 before them.

create or replace view public.stats_arcade_month
with (security_invoker = off) as
with cur as (
  select * from public.game_rounds
  where created_at >= now() - interval '30 days'
), prior as (
  select * from public.game_rounds
  where created_at >= now() - interval '60 days'
    and created_at < now() - interval '30 days'
)
select
  (select count(*) from cur)::bigint as rounds_30d,
  (select coalesce(sum(bet), 0) from cur)::bigint as wagered_30d,
  (select coalesce(sum(payout - bet), 0) from cur)::bigint as net_30d,
  (select count(*) filter (where won) from cur)::bigint as won_rounds_30d,
  (select count(distinct user_id) from cur)::bigint as players_30d,
  (select count(*) from prior)::bigint as rounds_prior_30d,
  (select coalesce(sum(bet), 0) from prior)::bigint as wagered_prior_30d;

grant select on public.stats_arcade_month to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Community month view gains the prior month',
  'stats_arcade_month appends rounds_prior_30d and wagered_prior_30d (columns appended, grants preserved — the 0064 convention) so the games hub community banner can show a month-over-month trend, mirroring the profile''s personal compare clause.',
  '{"version": "0077-1.0", "view": "stats_arcade_month", "appended": ["rounds_prior_30d", "wagered_prior_30d"]}'::jsonb
);

notify pgrst, 'reload schema';
