-- The purchase path wrote no feed row: purchase_item debited the coins and
-- incremented the stock, but every coin ledger that reads activity_events
-- (the live feed, the coin-flow card's earned/spent/net, the inventory
-- transaction list) never saw the spend. A 500-coin purchase was invisible.
-- This rewrite adds the feed insert on the success path — new kind
-- 'item_purchase', coins_amount carries the negative price so every ledger
-- counts it as spent. The kind is deliberately NOT 'streak_freeze': that kind
-- marks freeze RESCUES and feeds the shelf's rescue history, which a purchase
-- must not inflate. Identity columns resolve the same way logActivity does
-- (a profiles read); a member without a profile row feeds as anonymous.
-- Everything else is 0053's body verbatim.

drop function if exists public.purchase_item(uuid, text, int, int);

create function public.purchase_item(
  p_user_id uuid,
  p_item_key text,
  p_price int,
  p_cap int
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
begin
  select up.coins into v_coins
    from public.user_progress up
   where up.user_id = p_user_id
     for update;
  if not found then
    return query select false, 0, 0, 'no_progress';
    return;
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
    (user_id, username, avatar_url, kind, title, coins_amount, payload)
  values (
    p_user_id,
    v_username,
    v_avatar,
    'item_purchase',
    case when p_item_key = 'streak_freeze' then 'bought a Streak Freeze'
         else 'purchased ' || p_item_key end,
    -p_price,
    jsonb_build_object('item_key', p_item_key, 'price', p_price, 'quantity', v_qty)
  );

  return query select true, v_qty, v_coins, '';
end;
$$;

revoke all on all functions in schema public from anon, authenticated;
grant execute on function public.purchase_item(uuid, text, int, int) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Coin purchases now land in the feed and the coin ledgers',
  'The purchase RPC debited coins without writing an activity_events row, so the live feed, the coin-flow card and the inventory transaction list never saw a shop spend. purchase_item now inserts an item_purchase feed row on the success path — coins_amount carries the negative price, payload carries item_key/price/quantity, and the kind stays separate from streak_freeze so rescue history is not inflated. The inventory transaction list additionally merges game_rounds (payout minus bet) into one complete log.',
  '{"version": "purchase-feed-log-1.0", "risk": "low"}'::jsonb
);
