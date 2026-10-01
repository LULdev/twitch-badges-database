-- Freeze purchase: the first coin-spend path with a real failure signal.
-- No existing RPC checks-and-deducts atomically (add_coins silently clamps to
-- 0, so "too poor" is indistinguishable) — a TS-side compose of two RPCs
-- would be racy and lossy. One security-definer transaction: lock the
-- progress row, refuse on insufficient balance or a full stock (predicates
-- ARE the guarantee, the claim_daily_gate doctrine), else debit coins and
-- upsert the item in the same statement pair.

create or replace function public.purchase_item(
  p_user_id uuid,
  p_item_key text,
  p_price int,
  p_cap int
)
returns table (purchased boolean, quantity int, coins int, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row user_progress;
  v_qty int;
begin
  select * into v_row from public.user_progress where user_id = p_user_id for update;
  if not found then
    return query select false, 0, 0, 'no_progress';
    return;
  end if;

  v_qty := coalesce((
    select quantity from public.user_items
     where user_id = p_user_id and item_key = p_item_key
  ), 0);

  if v_qty >= p_cap then
    return query select false, v_qty, v_row.coins, 'at_cap';
    return;
  end if;

  if v_row.coins < p_price then
    return query select false, v_qty, v_row.coins, 'insufficient';
    return;
  end if;

  update public.user_progress
     set coins = coins - p_price,
         updated_at = now()
   where user_id = p_user_id
   returning coins into v_row.coins;

  insert into public.user_items as ui (user_id, item_key, quantity)
  values (p_user_id, p_item_key, 1)
  on conflict (user_id, item_key)
  do update set quantity = ui.quantity + 1, updated_at = now()
  returning quantity into v_qty;

  return query select true, v_qty, v_row.coins, '';
end;
$$;

revoke all on all functions in schema public from anon, authenticated;
grant execute on function public.purchase_item(uuid, text, int, int) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Streak Freezes are purchasable with BadgesCoins',
  'A buy button on your own item shelf purchases a Streak Freeze for the admin-editable economy price (default 500 coins, cap 5 in stock). Behind it: migration 0052s purchase_item RPC — the first coin-spend path with a real failure signal (insufficient / at_cap) — locking the progress row and debiting plus upserting in one transaction; a POST /api/items/buy route behind the player gate; and a client button that follows the servers answer and refreshes the shelf. The price rides the existing economy settings and is editable in the admin panel.',
  '{"version": "freeze-purchase-1.0", "rpc": "purchase_item", "defaultPrice": 500, "cap": 5}'::jsonb
);
