-- ============================================================
-- Maintenance mode removed.
--
-- The feature is gone from the code: the locale-layout gate, the edge check in
-- src/proxy.ts, the settings accessor, the panel section and its message keys.
-- What remains is the stored row, which nothing reads any more.
--
-- Why it was removed rather than repaired: the gate replaced every page of the
-- locale layout, including /login and /auth/callback, so a logged-out admin
-- could not sign in to switch it off. The bug hunt reported that as a one-way
-- door needing SQL to recover; the decision was to drop the feature instead.
-- ============================================================

delete from public.site_settings where key = 'maintenance';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Maintenance mode removed',
  'Maintenance mode is gone, on request. Its gate sat in the locale layout and replaced every page — including the login page — so it was a one-way door: a logged-out admin could not sign in to switch it off and recovery needed SQL. The bug hunt had reported exactly that, and rather than repair a feature nobody wanted, the layout gate, the edge check in the proxy, the settings accessor, the panel section and the message keys in all eleven locales were removed. This migration deletes the now-unread settings row so the stored state matches what the code does.',
  '{"removed": "maintenance-mode"}'::jsonb
);

notify pgrst, 'reload schema';
