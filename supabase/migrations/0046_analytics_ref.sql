-- Recap click-through attribution: the analytics pipeline deliberately strips
-- query strings at both ends (the beacon sends the pathname only, the track
-- route splits on "?"), so a ?ref=recap on the recap articles' game links
-- never reached analytics_events. Instead of weakening that privacy decision
-- with a raw query capture, the beacon gains an ALLOWLISTED ref field: the
-- client may send exactly "recap", everything else is dropped server-side.

alter table public.analytics_events
  add column if not exists ref text not null default '';

alter table public.analytics_events
  add constraint analytics_events_ref_allowlist
    check (ref in ('', 'recap'));

create index if not exists analytics_events_recap_idx
  on public.analytics_events (ts desc) where ref <> '';

create or replace view public.stats_analytics_recap_refs as
select path, count(*)::bigint as hits
from public.analytics_events
where ref = 'recap'
  and ts > now() - interval '30 days'
  and path <> ''
group by path
order by hits desc
limit 25;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Recap click-throughs become measurable',
  'The recap articles game links carry a ref=recap marker and the analytics pipeline now records it: the beacon may send an allowlisted ref value (only "recap" is accepted), the track route stores it in a new analytics_events column, and an aggregate view exposes the top linked game pages over 30 days for the admin stats panel. The raw query string is still never stored.',
  '{"version": "recap-attribution-1.0", "allowlist": ["recap"]}'::jsonb
);
