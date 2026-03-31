-- Réinitialise reservation_pending à l expiration du hold (dépend de reserve_cart_atomic).

create or replace function public.expire_wallet_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $expire$
declare
  v_count integer := 0;
  v_hold record;
begin
  for v_hold in
    update public.wallet_holds
    set
      status = 'expired',
      released_at = now(),
      updated_at = now()
    where status = 'active'
      and expires_at <= now()
    returning id, user_id, cart_id, amount_points
  loop
    insert into public.wallet_transactions (
      user_id,
      kind,
      direction,
      amount_points,
      status,
      metadata
    )
    values (
      v_hold.user_id,
      'release',
      'credit',
      v_hold.amount_points,
      'posted',
      jsonb_build_object('hold_id', v_hold.id, 'reason', 'expired', 'cart_id', v_hold.cart_id)
    );

    update public.items i
    set
      status = 'in_cart'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = v_hold.cart_id
      and ci.deleted_at is null
      and ci.item_id = i.id;

    update public.cart_items
    set
      status = 'in_cart',
      updated_at = now()
    where cart_id = v_hold.cart_id
      and deleted_at is null
      and status in ('reserved', 'reservation_pending');

    update public.carts
    set
      status = 'active',
      locked_until = null,
      updated_at = now()
    where id = v_hold.cart_id
      and status = 'reserved';

    insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
    values (v_hold.cart_id, 'reserved', 'active', 'wallet_hold_expired', null);

    perform public.log_activity_event(
      'wallet_hold_expired',
      jsonb_build_object('cart_id', v_hold.cart_id, 'hold_id', v_hold.id, 'amount_points', v_hold.amount_points),
      null
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$expire$;
