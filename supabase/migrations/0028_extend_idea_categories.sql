-- ============================================================
-- Extend the idea board's categories.
--
-- The board shipped with seven categories (profile, game, badge, design,
-- content, stats, other). The backlog import needs finer buckets: the operator's
-- own taxonomy separates the XP/level system, the coin economy, the admin
-- dashboard, performance work, usability work and game addons from the broader
-- buckets, and filing 200+ ideas into "other" and "game" would bury them.
--
-- "addon" is deliberately distinct from "game": game ideas are playable rounds,
-- addons are the meta-systems around the arcade.
-- ============================================================

alter table public.brainstorm_ideas
  drop constraint if exists brainstorm_ideas_category_check;

alter table public.brainstorm_ideas
  add constraint brainstorm_ideas_category_check
  check (category in (
    'profile', 'game', 'addon', 'badge', 'design', 'content', 'stats',
    'performance', 'usability', 'xp', 'coin', 'admin', 'other'
  ));

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Idea board: categories extended to separate XP, coins, admin, performance, usability and game addons',
  'The idea board shipped with seven categories, which was too coarse for the research backlog: the XP and level system, the BadgesCoins economy, the admin dashboard, performance work, usability work and game addons each need their own bucket, or two hundred ideas end up filed under "other" and "game" where nobody will find them. The check constraint now accepts thirteen categories, with "addon" kept distinct from "game" — a game is a playable round, an addon is the meta-system around the arcade.',
  '{"version": "ideas-categories-2.0"}'::jsonb
);

notify pgrst, 'reload schema';