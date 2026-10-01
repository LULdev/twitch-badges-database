-- Bugfix: 0052's purchase_item declared OUT parameters named `quantity` and
-- `coins`, which collide with the table columns user_items.quantity and
-- user_progress.coins inside the PL/pgSQL body — every call died with
-- 42702 "column reference is ambiguous". Exactly the trap 0017 hit for
-- consume_and_apply_game_xp (fixed in 0018 by renaming the outputs).
-- Renamed to out_* and the body's reads/writes fully qualified.

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

  return query select true, v_qty, v_coins, '';
end;
$$;

revoke all on all functions in schema public from anon, authenticated;
grant execute on function public.purchase_item(uuid, text, int, int) to service_role;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Freeze purchase RPC failed on ambiguous column names',
  'The 0052 purchase_item declared OUT parameters named quantity and coins, which shadow the user_items.quantity and user_progress.coins columns inside the PL/pgSQL body — every call died with 42702 before any purchase could happen. Renamed the outputs to out_quantity/out_coins (the 0018 precedent) and qualified every column reference; the E2E purchase cycle now passes end to end.',
  '{"version": "purchase-item-fix-1.0", "risk": "medium"}'::jsonb
);
