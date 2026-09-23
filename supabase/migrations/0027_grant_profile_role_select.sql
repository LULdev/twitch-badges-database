-- ============================================================
-- Grant SELECT on profiles.role to the public API roles.
--
-- Migration 0025 added `profiles.role`, but the column-level SELECT grants on
-- this table come from 0009/0010 and only cover the columns that existed then —
-- so an anon or authenticated read of `role` fails with 42501
-- ("permission denied for table profiles"). That is not a cosmetic problem: the
-- locale layout and the public profile page both read the column, and a failed
-- read there makes a signed-in visitor render as logged out.
--
-- The column is public by design: it drives the role badge shown on a member's
-- profile and in the header. `is_admin` stays unreadable to these roles.
-- ============================================================

grant select (role) on public.profiles to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'profiles.role made readable, fixing signed-in visitors rendering as logged out',
  'Migration 0025 added the role column but no SELECT grant for it, so the public API roles could not read it. The locale layout reads its columns through the anon client, and a failed read there left the header state at "logged out" for members who were in fact signed in. The column is now granted to anon and authenticated — it is public by design, driving the role badge on profiles and in the header — while is_admin remains unreadable to those roles.',
  '{"version": "acp-role-grant-1.0"}'::jsonb
);

notify pgrst, 'reload schema';