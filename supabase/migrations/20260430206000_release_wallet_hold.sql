-- Libération immédiate du hold wallet + retour panier/items en in_cart (sortie page paiement).

drop function if exists public.release_wallet_hold(uuid, text, text);

create or replace function public.release_wallet_hold(
  p_cart_id uuid,
  p_idempotency_key text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $release$
declare
  v_uid uuid;
  v_cart_owner uuid;
  v_hold_id uuid;
  v_amount bigint;
  v_idem text;
  v_reason text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select c.user_id
    into v_cart_owner
  from public.carts c
  where c.id = p_cart_id;

  if not found then
    raise exception 'Cart not found';
  end if;

  if v_cart_owner is distinct from v_uid then
    raise exception 'Forbidden: cart does not belong to current user';
  end if;

  update public.wallet_holds h
  set
    status = 'expired',
    released_at = now(),
    updated_at = now()
  where h.cart_id = p_cart_id
    and h.user_id = v_uid
    and h.status = 'active'
  returning h.id, h.amount_points into v_hold_id, v_amount;

  if v_hold_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_active_hold');
  end if;

  v_idem := coalesce(nullif(trim(p_idempotency_key), ''), 'release_wallet_hold:' || v_hold_id::text);
  v_reason := coalesce(nullif(trim(p_reason), ''), 'payment_page_exit');

  insert into public.wallet_transactions (
    user_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata
  )
  values (
    v_uid,
    'release',
    'credit',
    v_amount,
    'posted',
    v_idem,
    jsonb_build_object(
      'hold_id', v_hold_id,
      'reason', v_reason,
      'cart_id', p_cart_id
    )
  )
  on conflict (idempotency_key) do nothing;

  update public.items i
  set
    status = 'in_cart'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id;

  update public.cart_items
  set
    status = 'in_cart',
    updated_at = now()
  where cart_id = p_cart_id
    and deleted_at is null
    and status in ('reserved', 'reservation_pending');

  update public.carts
  set
    status = 'active',
    locked_until = null,
    updated_at = now()
  where id = p_cart_id
    and status = 'reserved';

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, 'reserved', 'active', 'wallet_hold_released_client', v_uid);

  perform public.log_activity_event(
    'wallet_hold_released',
    jsonb_build_object(
      'cart_id', p_cart_id,
      'hold_id', v_hold_id,
      'amount_points', v_amount,
      'release_reason', v_reason
    ),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'hold_id', v_hold_id,
    'amount_points', v_amount
  );
end;
$release$;

grant execute on function public.release_wallet_hold(uuid, text, text) to authenticated;
