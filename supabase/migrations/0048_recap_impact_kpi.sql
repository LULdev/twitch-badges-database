-- Public recap-impact KPI for the status page. The per-path recap_refs view
-- stays service-role-only on purpose: the ref is client-controlled, so any
-- page can carry ?ref=recap and land its path in that view — granting it to
-- anon would re-create the exposure 0030 removed (top_paths publishing raw
-- paths to the publishable key) and be attacker-pollutable. The public
-- surface gets the privacy-safe aggregate instead: one number, no paths.

create or replace view public.stats_analytics_recap_week
with (security_invoker = off) as
select count(*)::bigint as clicks_7d
from public.analytics_events
where ref = 'recap'
  and ts > now() - interval '7 days';

grant select on public.stats_analytics_recap_week to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Status page shows the weekly recap impact',
  'A new anon-readable aggregate view exposes one number — recap click-throughs over the last seven days, no paths — and the public status dashboard renders it as a one-line article-impact KPI. The per-path recap_refs view stays service-role-only because the ref marker is client-controlled and any page could pollute a path-granting view.',
  '{"version": "recap-impact-kpi-1.0", "view": "stats_analytics_recap_week"}'::jsonb
);
