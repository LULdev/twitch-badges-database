-- Recap push opt-out: a per-subscription switch so subscribers can keep
-- generic alerts (new badges, wheel, newsletter) but silence the daily and
-- weekly arcade recaps. Endpoint-scoped by design: the recap fanout reads
-- only push_subscriptions, and anonymous subscribers (user_id null) could
-- not be represented profile-side. Default true = opt-out, not opt-in.
--
-- No grants/policies: clients hold no table privileges since 0033 (the
-- subscribe route writes through the service role), and 0042 documented
-- that new columns inherit the table's existing privileges — the toggle
-- is reachable only through the server route, which is exactly the intent.

alter table public.push_subscriptions
  add column if not exists recap boolean not null default true;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Push subscriptions gain a recap opt-out switch',
  'Every push subscription now carries a recap flag (default on). The daily and weekly arcade recap fan-outs filter on it, so subscribers can silence recaps without losing new-badge or wheel alerts; the toggle lives in the notification settings and writes through the subscribe route, which also handles anonymous subscriptions.',
  '{"version": "recap-opt-out-1.0", "column": "recap", "default": true}'::jsonb
);
