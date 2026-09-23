-- ============================================================
-- Seed the remaining site_settings documents (ACP phase 4).
--
-- Migration 0025 inserted `maintenance` and `features` only. `economy`,
-- `games` and `admin` were left implicit: the code falls back to its own
-- defaults when a row is missing, so the site worked — but the settings table
-- did not show what was actually in force, and a hand-written
-- `update site_settings ... where key = 'economy'` silently matched nothing.
-- Writing the default document explicitly makes the table the truth.
--
-- The values here MUST stay in sync with ECONOMY_DEFAULTS in
-- src/lib/settings.ts. On conflict nothing happens, so a live value is never
-- overwritten by a re-run of this migration.
-- ============================================================

insert into public.site_settings (key, value) values
  ('economy', '{
    "dailyXp": 10,
    "dailyCoins": 50,
    "streakXpPerDay": 5,
    "streakXpCap": 50,
    "streakCoinsPerDay": 25,
    "streakCoinsCap": 250,
    "gameWinXp": 10,
    "gameLoseXp": 2,
    "coinRainCoins": 1,
    "stealPrice": 100,
    "stealMax": 250,
    "stealFloodMinutes": 5,
    "stealPerHour": 6
  }'::jsonb),
  -- `games.games` starts empty: an absent entry means "enabled, with the bet
  -- bounds from the game catalog", which is what keeps a newly added game
  -- playable without touching this document.
  ('games', '{"enabled": true, "games": {}}'::jsonb),
  -- The owner is registered later by the bootstrap flow; `grants` holds the
  -- extra admins and moderators.
  ('admin', '{"grants": []}'::jsonb)
on conflict (key) do nothing;

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Site settings: default documents for economy, games and admin written to the table',
  'The economy, games and admin settings documents are now created with their default values instead of existing only as a fallback in code. The behaviour is unchanged — the panel reads these values either way — but the settings table now shows the numbers actually in force, and a direct SQL update of one of these keys affects a real row instead of silently doing nothing.',
  '{"version": "acp-settings-seed-1.0"}'::jsonb
);

notify pgrst, 'reload schema';