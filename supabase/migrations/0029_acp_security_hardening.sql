-- ============================================================
-- ACP hardening: close the privilege and policy holes found by the bug hunt.
--
-- Supabase applies default privileges that grant ALL on every newly created
-- table in `public` to anon and authenticated. Migration 0025 created six
-- tables and inherited that blanket grant: each one now lists anon with
-- DELETE, INSERT, SELECT, UPDATE, TRUNCATE and more. Row-level security is what
-- actually stops writes (no write policy exists, so RLS denies), but that is one
-- mistake away from an open door — and one of them is already open:
--
--   * `analytics_events` carries an explicit permissive INSERT policy
--     (`with check (true)`), so anyone holding the publishable key — which is
--     shipped to every browser — can write raw rows through PostgREST and poison
--     all six aggregate views. The beacon does not need that: /api/track writes
--     with the service role, which bypasses RLS.
--   * `site_settings` is world-readable in full, so the `admin` document (the
--     owner's profile id and username, plus the grants roster) and
--     `acp_gate_state` (the bootstrap throttle counter) are public.
--
-- TRUNCATE deserves its own note: it is NOT subject to row-level security, so a
-- grant of TRUNCATE to anon is a table-wipe permission. PostgREST exposes no
-- truncate verb, which is the only reason it was unreachable.
-- ============================================================

-- 1) Take the blanket grants away, then grant back exactly what each table
--    actually needs from the public API roles.
revoke all on public.site_settings from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;
revoke all on public.bans from anon, authenticated;
revoke all on public.newsletter_drafts from anon, authenticated;
revoke all on public.admin_audit from anon, authenticated;
revoke all on public.brainstorm_ideas from anon, authenticated;

-- Public reads that the site genuinely needs.
grant select on public.site_settings to anon, authenticated;   -- filtered by the policy below
grant select on public.brainstorm_ideas to anon, authenticated;
grant select on public.bans to authenticated;                 -- owner-read policy limits the rows

-- analytics_events, admin_audit and newsletter_drafts get nothing: the beacon
-- and the panel both write with the service role, and the aggregate views are
-- `security_invoker = off`, so anon needs SELECT on the VIEW, not the base table.

-- 2) The beacon's write policy goes away with its grant. /api/track uses the
--    service role, so nothing legitimate depended on it.
drop policy if exists "analytics_anon_insert" on public.analytics_events;

-- 3) site_settings must stay publicly readable for maintenance mode, the feature
--    flags, the economy and the game switches — all of which public pages read.
--    Two keys are not public: the admin identity document and the bootstrap
--    throttle state. The policy now excludes them by key; the service role
--    (which the panel and the gate use) is unaffected by RLS.
drop policy if exists "settings_public_read" on public.site_settings;
create policy "settings_public_read" on public.site_settings
  for select using (key not in ('admin', 'acp_gate_state'));

-- 4) An atomic vote for the idea board.
--
--    The previous implementation read the counter, computed the new value in
--    JavaScript and wrote it back — a lost update on every concurrent vote, with
--    a comment claiming the opposite. `votes = greatest(0, votes + delta)` is one
--    statement and cannot lose a vote; the floor is enforced in the database
--    rather than racing in application code.
create or replace function public.vote_idea(p_id bigint, p_delta int)
returns int
language sql
security invoker
as $$
  update public.brainstorm_ideas
     set votes = greatest(0, votes + sign(p_delta)::int)
   where id = p_id
  returning votes;
$$;

revoke all on function public.vote_idea(bigint, int) from anon, authenticated;

-- 5) An atomic, per-caller bootstrap throttle.
--
--    The route's own counter was a read-modify-write: N concurrent wrong guesses
--    all read the same value and all wrote the same increment, so a five-attempt
--    budget cost the attacker five attempts *per concurrent request* — and a
--    failed write failed open. It was also global, which turned the only
--    owner-registration path into a denial of service: five wrong guesses from
--    anywhere locked the operator out for the rest of the window. The counter is
--    now per caller and incremented in one statement, with a generous total cap
--    so a distributed guess still runs out of road.
create or replace function public.acp_gate_attempt(
  p_ip text,
  p_window_ms bigint,
  p_max_per_ip int,
  p_max_total int
) returns table(allowed boolean, attempts int, total int)
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  started bigint := 0;
  ip_cnt int := 0;
  total_cnt int := 0;
begin
  select value into st from public.site_settings where key = 'acp_gate_state' for update;
  if st is null or jsonb_typeof(st) <> 'object' then
    st := '{}'::jsonb;
  end if;

  if (st ->> 'windowStartedAt') ~ '^[0-9]+$' then
    started := (st ->> 'windowStartedAt')::bigint;
  end if;

  if now_ms - started > p_window_ms then
    st := jsonb_build_object('windowStartedAt', now_ms, 'byIp', '{}'::jsonb);
  elsif jsonb_typeof(st -> 'byIp') is distinct from 'object' then
    st := jsonb_set(st, '{byIp}', '{}'::jsonb, true);
  end if;

  if (st #>> array['byIp', p_ip]) ~ '^[0-9]+$' then
    ip_cnt := (st #>> array['byIp', p_ip])::int;
  end if;

  select coalesce(sum(v::int), 0) into total_cnt
    from jsonb_each_text(st -> 'byIp') as e(k, v)
   where v ~ '^[0-9]+$';

  allowed := ip_cnt < p_max_per_ip and total_cnt < p_max_total;

  if allowed then
    ip_cnt := ip_cnt + 1;
    total_cnt := total_cnt + 1;
    st := jsonb_set(st, array['byIp', p_ip], to_jsonb(ip_cnt), true);
  end if;

  insert into public.site_settings (key, value, updated_at)
  values ('acp_gate_state', st, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return query select allowed, ip_cnt, total_cnt;
end $$;

revoke all on function public.acp_gate_attempt(text, bigint, int, int) from anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Admin panel security: blanket anon grants revoked, beacon insert hole closed, settings keys restricted, atomic idea voting',
  'The six tables created for the admin panel inherited Supabase''s default privileges, which grant anon every right including TRUNCATE — a table-wipe permission that row-level security cannot restrict (PostgREST exposing no truncate verb was the only thing making it unreachable). One of those grants was already a live hole: analytics_events carried a permissive INSERT policy, so anyone with the publishable key shipped to every browser could write raw rows and poison all six analytics aggregates; the beacon writes with the service role and never needed it. The world-readable settings policy also exposed the admin document (owner profile id and username plus the grant roster) and the bootstrap throttle counter, and now excludes those two keys. Idea voting moved from a read-modify-write lost update into a single greatest(0, votes + delta) statement behind a function the public roles cannot execute.',
  '{"version": "acp-security-1.1"}'::jsonb
);

notify pgrst, 'reload schema';
