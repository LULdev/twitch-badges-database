-- ============================================================
-- A failed reward used to consume the day's gate.
--
-- `claimDaily` / `spinWheel` commit their once-per-day gate
-- (`claim_daily_gate` / `claim_wheel_gate`) in one transaction and then pay the
-- reward with `award()` in a second. If the second transaction fails — a
-- transient `apply_xp_coins` error, a statement timeout, a read failure inside
-- `award` — the gate is already consumed: `last_login_date` / `last_wheel_date`
-- (and `wheel_spins`) have advanced, nothing was paid, and the retry is answered
-- "already claimed". There is no recovery path, and the wheel's `wheel_spins`
-- counter stands incremented with nothing paid.
--
-- These two functions reverse a gate that is STILL IN TODAY'S STATE, in one
-- atomic statement, so the caller can release it from a `catch` and let the
-- member retry. They are guarded on the date still being today's, so a gate that
-- has since moved on is never touched, and they are service-role only — the same
-- contract as the gates themselves (0007 / 0008).
-- ============================================================

-- 1) Release the daily gate. Re-opening means making `last_login_date` differ from
--    today without corrupting the streak arithmetic: `p_today - 1` makes the retry
--    recompute exactly the streak the failed claim would have had (the gate's
--    "yesterday" branch yields streak + 1, and the decremented `login_streak` is
--    what it adds to). `best_login_streak` is a high-water mark and is deliberately
--    left alone: the retry re-derives it.
create or replace function public.release_daily_gate(p_user_id uuid, p_today date)
returns void
language sql
as $$
  update public.user_progress
     set last_login_date = p_today - 1,
         login_streak = greatest(0, login_streak - 1),
         updated_at = now()
   where user_id = p_user_id
     and last_login_date = p_today;
$$;

-- 2) Release the wheel gate. Undoes the date AND the spin-counter increment the
--    gate applied, in the same statement, so a reopened retry cannot be counted as
--    a second, unpaid spin.
create or replace function public.release_wheel_gate(p_user_id uuid, p_today date)
returns void
language sql
as $$
  update public.user_progress
     set last_wheel_date = p_today - 1,
         wheel_spins = greatest(0, wheel_spins - 1),
         updated_at = now()
   where user_id = p_user_id
     and last_wheel_date = p_today;
$$;

-- PUBLIC first: a revoke that names only anon/authenticated leaves the default
-- grant to PUBLIC in place, which is exactly the hole the hunt found on
-- acp_gate_attempt.
revoke all on function public.release_daily_gate(uuid, date) from public;
revoke all on function public.release_wheel_gate(uuid, date) from public;
revoke all on function public.release_daily_gate(uuid, date) from anon, authenticated;
revoke all on function public.release_wheel_gate(uuid, date) from anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Economy: a failed reward no longer consumes the daily or wheel gate',
  'The daily login bonus and the wheel commit their once-per-day claim in a transaction separate from the reward, so a transient failure inside award() spent the whole day: the gate advanced, nothing was paid, and the retry was answered "already claimed" with no recovery path — the wheel even left wheel_spins incremented for a spin that never paid. Two service-role-only functions, release_daily_gate and release_wheel_gate, reverse a gate that is still in today state in a single atomic statement, so the caller can release it from a catch and let the member retry; the wheel release also undoes the counter increment. Both are guarded on the gate still pointing at today, so a gate that has since moved on is never touched, and both revoke from PUBLIC as well as from anon and authenticated.',
  '{"version": "atomic-counters-1.1"}'::jsonb
);

notify pgrst, 'reload schema';