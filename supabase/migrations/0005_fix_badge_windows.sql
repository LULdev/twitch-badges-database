-- ============================================================
-- 0005 — repair badge windows poisoned by the badgebase widget
-- ============================================================
--
-- Every stored end_date came from badgebase's `data-reset` attribute, which
-- belongs to the site's channel-points / giveaway overlay (`.qlog-reset`)
-- and always points at the next midnight. Proof: all 38 rows had the exact
-- same time of day (22:00:00 UTC = midnight CEST), independent of the badge.
--
-- The badge's real claim window lives in the detail page's schema.org
-- JSON-LD (`temporalCoverage: "<start>/<end>"`), which the parser now reads.
-- This migration removes the artefacts so the next sync writes real windows,
-- and re-activates the badges badgebase currently confirms as redeemable.

-- 1) Drop the widget-derived end dates. Only rows whose end lands on the
--    widget's fixed midnight are touched — a genuine window would not.
update public.badges
set end_date = null
where end_date is not null
  and to_char(end_date at time zone 'utc', 'HH24:MI:SS') = '22:00:00';

-- 2) Restore status for everything badgebase confirms as active. Guarded by
--    the start date so a genuinely upcoming badge stays upcoming.
update public.badges
set status = case
    when start_date is not null and start_date > now() then 'upcoming'
    else 'active'
  end
where is_confirmed_active = true
  and status <> 'removed'
  and status <> 'active';

-- 3) Re-classify the demoted rows that are NOT confirmed active: with the
--    bogus end date gone they fall back to 'upcoming' (future start) or
--    'expired' (permanent / no window).
update public.badges
set status = case
    when start_date is not null and start_date > now() then 'upcoming'
    when start_date is not null or end_date is not null then 'active'
    else 'expired'
  end
where is_confirmed_active = false
  and status <> 'removed'
  and status <> 'expired'
  and end_date is null;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Repaired badge windows poisoned by the badgebase reset widget',
  'All 38 stored end dates came from badgebase''s data-reset attribute, which is the channel-points/giveaway overlay countdown (.qlog-reset) and always points at the next midnight — every row shared the identical 22:00:00 UTC time. Because resolveStatus checked end_date before the confirmed-active flag, the 15-minute potat sweep expired all 22 currently redeemable badges and /active rendered empty. The migration clears the widget artefacts and restores the status of confirmed-active badges; the parser now reads the real window from the detail page JSON-LD temporalCoverage.',
  '{"version": "badge-window-1.0", "cleared_end_dates": 38, "cause": "qlog-reset-widget"}'::jsonb
);