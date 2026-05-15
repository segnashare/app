-- expire_wallet_holds (checkout), release_wallet_hold, trigger soft-delete ligne panier.

create or replace function public.expire_wallet_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $expire$
declare
  v_count integer := 0;
  v_cart record;
begin
  for v_cart in
    select c.id, c.user_id
    from public.carts c
    where c.status = 'checkout_pending'::public.cart_status
      and c.locked_until is not null
      and c.locked_until <= now()
    for update
  loop
    update public.items i
    set
      status = 'in_cart'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = v_cart.id
      and ci.deleted_at is null
      and ci.item_id = i.id;

    update public.cart_items
    set
      status = 'in_cart',
      updated_at = now()
    where cart_id = v_cart.id
      and deleted_at is null
      and status in ('reserved', 'reservation_pending');

    update public.carts
    set
      status = 'active',
      locked_until = null,
      updated_at = now()
    where id = v_cart.id;

    insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
    values (v_cart.id, 'checkout_pending', 'active', 'checkout_lock_expired', null);

    perform public.log_activity_event(
      'checkout_lock_expired',
      jsonb_build_object('cart_id', v_cart.id),
      null
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$expire$;

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

  if not exists (
    select 1 from public.carts c where c.id = p_cart_id and c.status = 'checkout_pending'::public.cart_status
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_checkout_pending');
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'payment_page_exit');

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
  where id = p_cart_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, 'checkout_pending', 'active', 'checkout_abandoned_client', v_uid);

  perform public.log_activity_event(
    'checkout_abandoned',
    jsonb_build_object(
      'cart_id', p_cart_id,
      'release_reason', v_reason
    ),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id
  );
end;
$release$;

grant execute on function public.release_wallet_hold(uuid, text, text) to authenticated;

create or replace function public.trg_cart_items_recompute_item_status_on_soft_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_item_id uuid;
  v_next_status public.item_status;
begin
  v_item_id := old.item_id;
  if v_item_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
      and ci.status = 'reserved'
  ) then
    v_next_status := 'reserved'::public.item_status;
  elsif exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('active'::public.cart_status, 'checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
  ) then
    v_next_status := 'in_cart'::public.item_status;
  else
    v_next_status := 'available'::public.item_status;
  end if;

  update public.items i
  set
    status = v_next_status,
    updated_at = now()
  where i.id = v_item_id
    and i.status is distinct from v_next_status;

  return new;
end;
$$;
