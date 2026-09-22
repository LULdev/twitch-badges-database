-- ============================================================
-- 0013 — catalog aggregate views (PostgREST 1000-row cap)
-- ============================================================
-- WHY THIS EXISTS (pdat-7): `getSiteStats()` computed the rarity distribution
-- and the category counts by selecting one row per badge from PostgREST, whose
-- response cap is 1000 rows. The catalog is already past that (475 rows today
-- and growing), so the /stats breakdowns were silently computed over a
-- truncated set — worse, the truncation was invisible because the count was
-- "plausible". Aggregating in SQL returns one row per distinct value, so the
-- result is complete no matter how large the catalog becomes.

create or replace view public.stats_catalog_rarity
with (security_invoker = off) as
select rarity_tier, count(*)::bigint as count
from public.badges
where rarity_tier is not null
group by rarity_tier;

create or replace view public.stats_catalog_categories
with (security_invoker = off) as
select category, count(*)::bigint as count
from public.badges
group by category;

grant select on public.stats_catalog_rarity to anon, authenticated;
grant select on public.stats_catalog_categories to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Stats rarity/category breakdowns no longer truncated at 1000 badges',
  'getSiteStats() derived the rarity distribution and category counts from a per-row PostgREST select, which is capped at 1000 rows — past that the /stats breakdowns were silently incomplete. The two aggregates now come from the stats_catalog_rarity and stats_catalog_categories views, which return one row per distinct value and are therefore complete at any catalog size.',
  '{"version": "catalog-aggregates-1.0"}'::jsonb
);