-- ============================================================
-- 0042 — a risk triage level on every changelog row
-- ============================================================
-- WHY THIS EXISTS
-- The changelog mixes routine sync summaries with rows that record something
-- having actually gone wrong, and they are indistinguishable at a glance: an
-- operator triaging an incident has to open payloads and re-read bodies to
-- find the failures. This migration adds a NOT NULL `risk` column
-- (low | medium | high) and backfills it deterministically from what each
-- row already records, so the feed can be triaged by a single field:
--
--   high   — the run failed or was deliberately skipped: payload says
--            failed / fanoutFailed / allDetailsFailed = true, or carries the
--            `skipped` key of the truncated-listing guard (badgebase.ts).
--   medium — a bug was fixed (kind = 'bugfix'), or a data_sync run demoted
--            badges to expired (payload->>'demotedToExpired' > 0).
--   low    — everything else; also the column default for new rows.
--
-- The ADD COLUMN is metadata-only (PG 11+ fills existing rows from the
-- catalog default — same pattern as 0002 / 0003 / 0025, which added NOT
-- NULL DEFAULT columns to populated tables), and the default satisfies the
-- CHECK, so no NOT NULL or CHECK violation can arise. The backfill is one
-- UPDATE whose CASE stops at the first matching WHEN: the WHEN order
-- high -> medium -> low IS the priority and makes the result deterministic.
-- No grant or policy statements: changelog privileges are table-level only
-- (0001), so the new column inherits public-read / service-role-write.

alter table public.changelog
  add column if not exists risk text not null default 'low'
  check (risk in ('low', 'medium', 'high'));

update public.changelog
set risk = case
  when payload->>'failed' = 'true'
    or payload->>'fanoutFailed' = 'true'
    or payload->>'allDetailsFailed' = 'true'
    or payload ? 'skipped'
    then 'high'
  when kind = 'bugfix'
    or (
      kind = 'data_sync'
      and coalesce((payload->>'demotedToExpired')::int, 0) > 0
    )
    then 'medium'
  else 'low'
end;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Changelog entries carry a risk level',
  'Every changelog row now has a risk column — low, medium or high — so operators can triage the feed instead of re-reading routine sync summaries hunting for the one row where something went wrong. The column lands with a default of low and a CHECK constraint, and existing rows are backfilled deterministically in one pass from what they already record: entries whose payload says the run failed or was deliberately skipped (failed, fanoutFailed or allDetailsFailed true, or the skipped key of the truncated-listing guard) become high, bugfixes and data_sync runs that demoted badges to expired become medium, and everything else stays low. logChange, logChanges and the log:change CLI accept an optional risk, and the admin changelog editor gains a risk select.',
  '{"version": "changelog-risk-1.0"}'::jsonb
);
