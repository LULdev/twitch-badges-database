-- ============================================================
-- 0065 — fix PUBLIC EXECUTE on SECURITY DEFINER economy RPCs,
--        resurrect dead service_role grants, restore record-break
--        RPC grants, and harden two economy-adjacent functions
-- ============================================================
-- Bug-hunt 2026-10-06 (docs/bug-hunt/REPORT.md), clusters P0-1, P1-1, P0-2
-- and the momentum baseline of P1-5.
--
-- 1) PUBLIC default EXECUTE: three SECURITY DEFINER economy RPCs stayed
--    callable by anyone holding the publishable anon key via /rest/v1/rpc,
--    because every post-0041 migration revoked only `anon, authenticated`.
--    PostgreSQL's default `PUBLIC EXECUTE` survives `create or replace`
--    untouched, and the DROP + recreate sites (0049:66, 0053:8, 0059:13)
--    re-armed it; 0050's rewrite revoked nothing at all. 0037's doctrine
--    ("objects start from nothing") never applied to PUBLIC: the default
--    privileges it changed strip only anon/authenticated, and API roles
--    reach PUBLIC grants as implicit members — the causal chain behind the
--    P0 cluster. purchase_item with a caller-supplied p_price could mint
--    coins (negative price), grant_starter_items minted freezes for any
--    uuid, game_streak_gate forged any player's streak. Per-function
--    revokes below — deliberately NOT a schema-wide
--    `revoke all on all functions ... from public`, which would also kill
--    the read-only leaderboard RPCs re-granted in section 3.
-- 2) Four service-role functions were DEAD since 0029/0032/0034: their
--    PUBLIC + anon/authenticated revokes exist, but no migration ever
--    granted EXECUTE back to service_role, so gate release after a failed
--    award (release_*_gate), the ACP bootstrap door (acp_gate_attempt) and
--    every idea-board vote (vote_idea) failed 42501.
-- 3) 0059's schema-wide `revoke ... from anon, authenticated` destroyed the
--    explicit anon/authenticated EXECUTE grants that 0056 and 0058 placed
--    on the two read-only record-break RPCs; they still work only through
--    the PUBLIC default, which section 4 revokes for future objects.
-- 4) The schema defaults no longer hand EXECUTE to PUBLIC, so future
--    functions start with no EXECUTE grant at all and every grant is
--    deliberate (mirrors 0037's statements, extended to PUBLIC).
-- 5) apply_pair_deltas clamped each side independently, so two parallel
--    steals against two victims with a balance in [price, 2·price) both
--    committed: the thief paid what he had while both victims were credited
--    the full price — minting the difference. The rewrite re-reads the payer
--    under a row lock and raises instead of clamping.
-- 6) badge_momentum derived "24h growth" from the newest measured point at
--    least 20h old with no lower bound: quiet syncs made it cumulative and
--    ratcheted the stored rarity_score. A freshness floor [now - 48h,
--    now - 20h] yields NULL (neutral momentum) instead.
-- ============================================================

-- 1) Close PUBLIC EXECUTE on the three SECURITY DEFINER economy RPCs.
--    service_role keeps its explicit grants — only the PUBLIC default goes.
revoke all on function public.game_streak_gate(uuid, date) from public;
revoke all on function public.grant_starter_items(uuid) from public;
revoke all on function public.purchase_item(uuid, text, int, int) from public;

-- 2) Resurrect the four dead service_role grants (0029/0032/0034 revoked
--    the public roles but never granted back). The public roles stay revoked
--    on every one of them.
grant execute on function public.release_daily_gate(uuid, date) to service_role;
grant execute on function public.release_wheel_gate(uuid, date) to service_role;
grant execute on function public.acp_gate_attempt(text, bigint, int, int) to service_role;
grant execute on function public.vote_idea(bigint, int) to service_role;

-- 3) Restore the explicit record-break RPC grants destroyed by 0059's
--    schema-wide revoke, verbatim from 0056:39-40 and 0058:50-51. Without
--    them the profile best-rounds card, the recap "your breaks" line and the
--    /stats ?period= leaderboard depend on the PUBLIC default revoked below.
grant execute on function public.player_record_history(uuid, int, timestamptz, timestamptz)
  to anon, authenticated, service_role;

grant execute on function public.record_break_leaders(int)
  to anon, authenticated, service_role;

-- 4) Root cause: stop the schema defaults from handing EXECUTE to PUBLIC.
--    Existing functions keep their ACLs; every function created from here on
--    starts with no EXECUTE grant at all and needs an explicit one. Syntax
--    mirrors the 0037 statements (schema public only, function objects only).
alter default privileges in schema public
  revoke execute on functions from public;

-- 5) Steal settlement aborts when the thief cannot cover the attempt cost.
create or replace function public.apply_pair_deltas(
  p_a uuid,
  p_a_delta bigint,
  p_b uuid,
  p_b_delta bigint
)
returns table (a_coins bigint, b_coins bigint)
language plpgsql
-- search_path convention shared by the project's plpgsql functions; this
-- one stays invoker-rights like the original (service_role is the only
-- caller), the setting is still pinned for consistency.
set search_path = public
as $$
declare
  v_a bigint;
begin
  -- Lock the A row before judging affordability: without the lock, two
  -- parallel steals both pass on the pre-check balance and the second
  -- overdraws an account the old clamp would silently "forgive" — the mint.
  select coins into v_a
    from public.user_progress
   where user_id = p_a
   for update;

  -- The A side is the payer: a negative delta it cannot cover must abort the
  -- whole pair, not clamp. The exception rolls the transaction back, so no
  -- balance moves; the caller (daily.ts) voids its attempt row and rethrows.
  if p_a_delta < 0 and v_a + p_a_delta < 0 then
    raise exception
      'thief cannot cover the steal cost (balance %, cost %)',
      v_a, -p_a_delta;
  end if;

  update public.user_progress
     set coins = greatest(0, coins + p_a_delta),
         updated_at = now()
   where user_id = p_a
  returning coins into a_coins;

  -- B side unchanged: the victim never goes negative, and the credit is
  -- always funded 1:1 by the A debit checked above (p_b_delta = -p_a_delta
  -- in the steal flow; in the coin-rain flow p_b is also a receiver).
  update public.user_progress
     set coins = greatest(0, coins + p_b_delta),
         updated_at = now()
   where user_id = p_b
  returning coins into b_coins;

  return next;
end;
$$;

-- 6) Freshness floor for the badge_momentum baseline. The coalesce is
--    removed so a missing in-window point yields NULL (neutral 0.5 in
--    rarity.ts), not 0; `source = 'measured'` excludes archive captures.
create or replace view public.badge_momentum
with (security_invoker = true) as
select
  b.id as badge_id,
  b.active_count,
  b.active_count - h.active_count as growth_24h
from public.badges b
left join lateral (
  select s.active_count
  from public.badge_stats s
  where s.badge_id = b.id
    and s.source = 'measured'
    and s.polled_at <= now() - interval '20 hours'
    and s.polled_at >= now() - interval '48 hours'
  order by s.polled_at desc
  limit 1
) h on true
where b.end_date is not null
  and b.status <> 'removed';

grant select on public.badge_momentum to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Anon-callable economy RPCs closed, dead service_role grants revived, record-break RPC grants restored, pair-delta affordability enforced, momentum baseline freshened',
  'The bug hunt found five economy-adjacent holes. (1) Three SECURITY DEFINER economy RPCs — game_streak_gate, grant_starter_items, purchase_item — stayed executable by anyone holding the publishable anon key: every post-0041 migration revoked only anon and authenticated, and PostgreSQL default PUBLIC EXECUTE survives create or replace and is re-armed by drop+recreate, so a negative caller-supplied price on purchase_item could mint coins and freezes could be granted to any profile uuid. Per-function revokes from PUBLIC close them; service_role grants are unchanged. (2) release_daily_gate, release_wheel_gate, acp_gate_attempt and vote_idea were revoked from the public roles without ever being granted back to service_role, so a failed award burned the daily/wheel gate forever, the ACP bootstrap door could not complete on a fresh install and every idea-board vote failed 42501 — all four now carry the service_role grant. (3) The schema-wide anon/authenticated revoke in 0059 had silently destroyed the explicit grants on player_record_history and record_break_leaders, which kept working only through the PUBLIC default; they are re-granted explicitly. (4) The schema default privileges no longer grant EXECUTE to PUBLIC, so future functions start with no EXECUTE grant and every grant is deliberate. (5) apply_pair_deltas clamped payer and receiver independently, so two parallel steals against two victims with a balance in [price, 2·price) both committed and minted the difference; the function now re-reads the payer row under a row lock and raises when the attempt cost cannot be covered, instead of silently clamping. (6) badge_momentum derived 24h growth from the newest measured point at least 20h old with no lower bound, so quiet syncs made it cumulative and ratcheted stored rarity scores; a 48-hour freshness floor makes a missing baseline yield NULL, which the rarity consumers already treat as neutral.',
  '{"version": "security-economy-1.0", "rpcs": ["game_streak_gate", "grant_starter_items", "purchase_item", "release_daily_gate", "release_wheel_gate", "acp_gate_attempt", "vote_idea", "player_record_history", "record_break_leaders", "apply_pair_deltas"]}'::jsonb
);

notify pgrst, 'reload schema';