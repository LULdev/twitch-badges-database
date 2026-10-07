-- ============================================================
-- 0067 — idempotent coin purchases (client nonce, the 0063 doctrine
--        transferred from game-round settlement to the shop)
-- ============================================================
-- P2 of the bug hunt: /api/items/buy had no idempotency key, so a retry
-- after a lost response — or a double-click — bought two Streak Freezes for
-- twice the price; purchase_item is atomic per call but stateless across
-- calls. The client now sends a nonce (uuid) per buy intent; the
-- item_purchase feed row stores it, and a retry with the same nonce replays
-- the committed receipt instead of debiting coins a second time. The
-- (user_id, client_nonce) unique index is the atomic guard, mirroring
-- game_rounds_client_nonce_idx. The replay check runs UNDER the user_progress
-- row lock the RPC already takes, so of two racing same-nonce calls exactly
-- one purchases and the other sees the winner's committed row.

alter table public.activity_events
  add column if not exists client_nonce text;

-- Partial index: legacy rows and non-purchase events are not covered; only
-- purchases carry a nonce. Because 0040 grants anon/authenticated SELECT on
-- nine named columns only, the nonce itself is never readable through
-- PostgREST — this index is the only consumer beside the RPC.
create unique index if not exists activity_events_client_nonce_idx
  on public.activity_events (user_id, client_nonce)
  where client_nonce is not null;

-- 0059's body + one optional nonce parameter, checked inside the same
-- transaction. Drop+recreate (the 0053 precedent) because `create or
-- replace` cannot change the signature.
drop function if exists public.purchase_item(uuid, text, int, int);

create function public.purchase_item(
  p_user_id uuid,
  p_item_key text,
  p_price int,
  p_cap int,
  p_nonce text default null
)
returns table (purchased boolean, out_quantity int, out_coins int, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins int;
  v_qty int;
  v_username text;
  v_avatar text;
  v_replay_qty int;
begin
  select up.coins into v_coins
    from public.user_progress up
   where up.user_id = p_user_id
     for update;
  if not found then
    return query select false, 0, 0, 'no_progress';
    return;
  end if;

  -- Idempotency (0063 doctrine): a retry whose first response was lost carries
  -- the same nonce. That purchase already happened, so replay the committed
  -- receipt instead of charging twice. Deliberately BEFORE every gate (cap,
  -- balance) and under the row lock: the purchase already settled, so today's
  -- balance or stock cannot change its verdict — the only honest answer is the
  -- committed one. Two racing same-nonce calls serialize on the lock above;
  -- the loser sees the winner's committed feed row here, and the unique index
  -- is the atomic backstop.
  if p_nonce is not null then
    select coalesce((ae.payload->>'quantity')::int, 0) into v_replay_qty
      from public.activity_events ae
     where ae.user_id = p_user_id
       and ae.client_nonce = p_nonce
       and ae.kind = 'item_purchase'
     limit 1;
    if found then
      return query select true, v_replay_qty, v_coins, '';
      return;
    end if;
  end if;

  select ui.quantity into v_qty
    from public.user_items ui
   where ui.user_id = p_user_id and ui.item_key = p_item_key;
  v_qty := coalesce(v_qty, 0);

  if v_qty >= p_cap then
    return query select false, v_qty, v_coins, 'at_cap';
    return;
  end if;

  if v_coins < p_price then
    return query select false, v_qty, v_coins, 'insufficient';
    return;
  end if;

  update public.user_progress up
     set coins = up.coins - p_price,
         updated_at = now()
   where up.user_id = p_user_id
   returning up.coins into v_coins;

  insert into public.user_items as ui (user_id, item_key, quantity)
  values (p_user_id, p_item_key, 1)
  on conflict (user_id, item_key)
  do update set quantity = ui.quantity + 1, updated_at = now()
  returning ui.quantity into v_qty;

  select pr.username, pr.avatar_url into v_username, v_avatar
    from public.profiles pr
   where pr.id = p_user_id;

  insert into public.activity_events
    (user_id, username, avatar_url, kind, title, coins_amount, payload, client_nonce)
  values (
    p_user_id,
    v_username,
    v_avatar,
    'item_purchase',
    case when p_item_key = 'streak_freeze' then 'bought a Streak Freeze'
         else 'purchased ' || p_item_key end,
    -p_price,
    jsonb_build_object('item_key', p_item_key, 'price', p_price, 'quantity', v_qty),
    p_nonce
  );

  return query select true, v_qty, v_coins, '';
end;
$$;

-- Per-function revoke, the 0065 idiom. Deliberately NOT 0059's schema-wide
-- `revoke ... from anon, authenticated`, which would again destroy the
-- explicit 0056/0058 grants on the record-break RPCs that 0065 restored
-- (and with the PUBLIC default gone, they would break for real this time).
-- 0065's altered default privileges already prevent PUBLIC EXECUTE on this
-- new function; the explicit revoke from public is belt-and-braces.
revoke all on function public.purchase_item(uuid, text, int, int, text)
  from anon, authenticated, public;
grant execute on function public.purchase_item(uuid, text, int, int, text)
  to service_role;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Idempotent purchases: buy retries replay instead of double-charging',
  '/api/items/buy had no idempotency key, so a retry after a lost response or a double-click bought two Streak Freezes for twice the price. The purchase RPC now takes an optional client nonce (the 0063 game-round doctrine transferred to the shop): the item_purchase feed row stores it under a unique (user_id, client_nonce) index, the replay check runs under the user_progress row lock the RPC already takes, and a retry with the same nonce returns the committed receipt (purchased, quantity at purchase time, current balance) instead of debiting coins again. The buy button mints one nonce per intent, keeps it across network failures and clears it on a definitive server answer.',
  '{"version": "purchase-nonce-1.0", "column": "activity_events.client_nonce", "index": "activity_events_client_nonce_idx"}'::jsonb
);

notify pgrst, 'reload schema';