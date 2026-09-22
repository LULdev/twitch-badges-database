-- v23-01: 0018 dropped and recreated consume_and_apply_game_xp to rename its OUT
-- columns, and `create or replace` — or a fresh create after a drop — resets the
-- ACL to the default, which grants EXECUTE to PUBLIC. So the function that 0017
-- had correctly restricted came back callable by PUBLIC, anon and authenticated,
-- while its two siblings stayed service-role only.
--
-- Not exploitable on its own (anon has no UPDATE on user_progress, so the call
-- fails at the update), but it is the exact exposure an earlier round closed for
-- every other economy RPC. Re-applied here, and this is the last migration that
-- touches this function.

revoke all on function public.consume_and_apply_game_xp(uuid, date, int, bigint) from public;
revoke all on function public.consume_and_apply_game_xp(uuid, date, int, bigint) from anon, authenticated;
grant execute on function public.consume_and_apply_game_xp(uuid, date, int, bigint) to service_role;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Economy RPC: the recreated function had lost its service-role-only grant',
  'Dropping and recreating consume_and_apply_game_xp to rename its output columns reset the function ACL to the default, which grants EXECUTE to PUBLIC — so the one economy helper that had been locked down came back callable by anon and authenticated while its siblings stayed restricted. A call from anon still fails because the role lacks UPDATE on user_progress, so nothing was exploitable, but the exposure is re-closed here.',
  '{"version": "game-xp-grants-1.0"}'::jsonb
);

notify pgrst, 'reload schema';