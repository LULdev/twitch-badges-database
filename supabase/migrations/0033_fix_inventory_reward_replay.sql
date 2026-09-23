-- ============================================================
-- The badge-unlock reward could be farmed without limit.
--
-- `syncUserInventory` pays 1,000 XP and 500 coins per badge it finds newly
-- present in `user_inventory` (src/lib/inventory.ts). The set of "newly
-- present" badges is just "owned ids not currently in the table", so the reward
-- was a function of table state rather than of a recorded payment — and the
-- table's contents were the member's to change:
--
--   * `authenticated` held DELETE on `user_inventory`, and the
--     `inventory_self_delete` policy allowed it on their own rows;
--   * /api/inventory/sync has no server-side throttle.
--
-- DELETE the rows, call the sync, and every badge is "newly claimed" again:
-- unlimited XP and coins, repeatable for as long as anyone cares to loop.
--
-- Two fixes, because either alone leaves a hole. The member loses the ability to
-- delete those rows at all (the sync is the only writer, and it uses the service
-- role), and the payment itself becomes idempotent — a per-(member, badge) record
-- is claimed before anything is paid, so a badge can never pay twice no matter
-- how its row churns.
-- ============================================================

-- 1) Stop the client-side churn that made the replay possible.
drop policy if exists "inventory_self_delete" on public.user_inventory;
revoke delete, update on public.user_inventory from anon, authenticated;
-- SELECT stays: the public inventory view reads through `inventory_read`.

-- 2) Record the payments, so the reward is a fact rather than an inference.
create table if not exists public.badge_unlock_rewards (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id uuid not null references public.badges (id) on delete cascade,
  xp int not null default 1000,
  coins int not null default 500,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

alter table public.badge_unlock_rewards enable row level security;
-- No policies on purpose: the sync writes and reads this with the service role.
-- A member has no business knowing the payout ledger, and nothing else needs it.
revoke all on public.badge_unlock_rewards from anon, authenticated;

-- Existing holdings count as already rewarded. The tables are empty today, so
-- this is a no-op in practice — but on a populated installation it is what stops
-- the first sync after this migration from paying everybody again for the badges
-- they already own.
insert into public.badge_unlock_rewards (user_id, badge_id)
select user_id, badge_id from public.user_inventory
on conflict do nothing;

-- 3) `push_subscriptions` was worse: anon and authenticated held INSERT, UPDATE
--    and DELETE, with an INSERT policy of `with check (true)` and a DELETE policy
--    matching `user_id IS NULL`. Anyone holding the publishable key could insert
--    arbitrary endpoint rows — bypassing the route's endpoint validation, which
--    exists to stop the server being pointed at internal addresses — and delete
--    every anonymous subscription.
--
--    The route writes with the service role, so none of those grants were needed.
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;
drop policy if exists "push_insert" on public.push_subscriptions;
drop policy if exists "push_self_delete" on public.push_subscriptions;
-- `push_self_read` stays: a member seeing their own endpoints is harmless.

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Critical: the badge-unlock reward could be farmed without limit',
  'Sync paid 1,000 XP and 500 coins for every badge it found newly present in user_inventory, and "newly present" was decided by what the table held rather than by a record of what had been paid. Since authenticated held DELETE on that table with a policy allowing it on the caller own rows, and the sync endpoint has no throttle, a member could delete their inventory rows, call the sync, and be paid again for every badge they owned — repeatedly and without limit. The delete grant and its policy are gone (the sync is the only writer and uses the service role), and the payment is now idempotent: a badge_unlock_rewards row is claimed before anything is paid, with the ownership ledger cascading from the profile and badge it names and readable only by the service role. The push subscription table had the same shape of hole — anon and authenticated could insert with no check, which bypassed the endpoint validation that keeps the server from being pointed at internal addresses, and could delete anonymous subscriptions; those grants and both policies are revoked, and the route continues to write with the service role.',
  '{"version": "acp-security-3.0", "severity": "critical"}'::jsonb
);

notify pgrst, 'reload schema';