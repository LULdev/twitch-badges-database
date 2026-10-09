-- "Jackpot only" push preference: a per-subscription opt-IN so subscribers can
-- silence everything EXCEPT the rare jackpot alerts — new badges, recaps,
-- newsletters and manual sends skip these rows, the jackpot fan-outs keep
-- reaching them. The mirror of 0045's recap opt-out, with the inverse default
-- (false = receive everything, the state every existing row is in).
--
-- Endpoint-scoped for the same reason as 0045: anonymous subscribers (user_id
-- null) could not be represented profile-side. No grants/policies: clients
-- hold no table privileges since 0033 and new columns inherit the table's
-- existing privileges — the toggle is reachable only through the subscribe
-- route, which is exactly the intent.

alter table public.push_subscriptions
  add column if not exists jackpot_only boolean not null default false;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Push subscriptions gain a "jackpot only" opt-in',
  'Every push subscription now carries a jackpot_only flag (default off). When enabled, the subscriber receives ONLY jackpot alerts — badge drops, arcade recaps, newsletters and manual sends filter these rows out — while jackpot alerts keep reaching every subscriber as before. The toggle lives in the notification settings next to the recap opt-out and writes through the subscribe route, which also handles anonymous subscriptions.',
  '{"version": "push-jackpot-only-1.0", "column": "jackpot_only", "default": false}'::jsonb
);
