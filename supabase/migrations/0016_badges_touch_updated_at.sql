-- v13-05: `touch_updated_at()` stamps `updated_at` on ANY update, and the global
-- sync touches every catalog row on every run — `last_seen_at` is what
-- `/api/health` reads to report catalog freshness, so it must keep moving. The
-- side effect was that all ~476 rows received a fresh `updated_at` several times
-- a day, which defeated the sitemap's `lastModified` (an earlier round
-- deliberately replaced `new Date()` with real per-row timestamps).
--
-- A badges-specific trigger keeps the previous `updated_at` when nothing but
-- `last_seen_at` moved. `profiles` and `blog_posts` keep the unconditional
-- behaviour — their `updated_at` is user-facing content freshness.

create or replace function public.touch_badges_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'last_seen_at' - 'updated_at')
     = (to_jsonb(old) - 'last_seen_at' - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists badges_touch_updated on public.badges;
create trigger badges_touch_updated before update on public.badges
  for each row execute function public.touch_badges_updated_at();

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Catalog rows keep their updated_at when only the freshness stamp moves',
  'The shared touch trigger refreshed updated_at on every update, and the catalog sync touches all rows on every run to keep last_seen_at current for the health endpoint. That made every badge look modified several times a day and defeated the sitemap''s per-row lastModified. A badges-specific trigger now preserves updated_at when nothing but last_seen_at changed; profiles and blog posts keep the unconditional behaviour because their updated_at is user-facing content freshness.',
  '{"version": "badges-touch-1.0"}'::jsonb
);

notify pgrst, 'reload schema';