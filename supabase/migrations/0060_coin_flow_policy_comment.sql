-- 0054's header claimed the coin-flow view exposes "nothing the live feed does
-- not already show". That stopped being true when admin_adjust ledger rows
-- shipped: they are deliberately excluded from the public feed (both /api/feed
-- and the SSR /feed page) yet stay IN this aggregate, because an admin
-- correction is real coin creation, not a broadcastable event. The applied
-- 0054 file is not edited — this migration carries the corrected statement
-- into the database itself, so the view documents its own policy where anyone
-- inspecting the schema will read it.
--
-- Behavior is unchanged on purpose: the view keeps counting every ledger row
-- with a nonzero coins_amount (that IS the documented policy now). Regular
-- arcade rounds have no ledger row at all — their net lives in game_rounds —
-- which is why they are absent here and named in the user-facing note.

comment on view public.stats_coin_flow_daily is
  'Aggregate of ledger-logged coin movements (activity_events.coins_amount), one row per UTC day, gross on both sides. Deliberately INCLUDES admin_adjust rows — coin creation never broadcast as an individual feed entry — and includes every other kind with a ledger row; regular arcade rounds (no activity_events row, see game_rounds) are absent. Aggregates only: no per-user data. Policy decided when admin_adjust shipped (2026-10-05); supersedes the claim in 0054''s file header.';

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Coin-flow view now documents its own inclusion policy',
  'Migration 0054 header claimed the public coin-flow aggregate exposes nothing the live feed does not already show — untrue since admin_adjust ledger rows shipped, which are deliberately hidden from the public feed but stay in the aggregate as real coin creation. Migration 0060 writes the corrected policy as a SQL comment on stats_coin_flow_daily (0054 itself is applied and untouched), and the /stats card note in all 11 locales drops the stale "shop purchases move coins outside the feed" claim, which had been false since purchases started writing item_purchase feed rows (0059).',
  '{"version": "coin-flow-policy-1.0", "risk": "none-docs-only"}'::jsonb
);
