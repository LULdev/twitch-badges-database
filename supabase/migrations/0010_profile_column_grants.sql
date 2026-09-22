-- ============================================================
-- 0010 — keep the public profile fully functional after 0009
-- ============================================================
-- 0009 restricted the public SELECT on `profiles` to a column list, which
-- deliberately excludes `twitch_id` (the Twitch account id — identity data that
-- no public page renders). `potat_connections` IS rendered on the public
-- profile ("connected accounts" row), so it belongs in the granted set.

grant select (potat_connections) on public.profiles to anon, authenticated;

-- The application must stop requesting every column; it now reads an explicit
-- list. Verified after this migration:
--   GET /rest/v1/profiles?select=id,twitch_id  → 401 permission denied
--   GET /rest/v1/profiles?select=id,username   → 200

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Public profile: connected accounts stay visible, Twitch account id stays private',
  'The column-level grant from 0009 excluded potat_connections, which the public profile actually renders as the connected-accounts row — the page would have lost that section. The column is granted again while twitch_id (the Twitch account identifier, used only for inventory identity matching) remains unreachable from the public API. The app reads an explicit column list instead of select(*).',
  '{"version": "profile-columns-1.0"}'::jsonb
);