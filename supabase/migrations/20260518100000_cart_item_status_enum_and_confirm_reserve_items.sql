-- 1) Type Postgres pour cart_items.status (remplace text + CHECK).
-- 2) Après paiement Stripe : items.status = reserved + lignes in_cart|reservation_pending|reserved → reserved.

do $body$
begin
  create type public.cart_item_status as enum (
    'in_cart',
    'reserved',
    'archived',
    'reservation_pending',
    'verification_pending',
    'verified',
    'rejected',
    'needs_cleaning'
  );
exception
  when duplicate_object then null;
end $body$;

alter table public.cart_items drop constraint if exists cart_items_status_check;

alter table public.cart_items
  alter column status drop default;

alter table public.cart_items
  alter column status type public.cart_item_status
  using (
    case trim(lower(status::text))
      when 'in_cart' then 'in_cart'::public.cart_item_status
      when 'reserved' then 'reserved'::public.cart_item_status
      when 'archived' then 'archived'::public.cart_item_status
      when 'reservation_pending' then 'reservation_pending'::public.cart_item_status
      when 'verification_pending' then 'verification_pending'::public.cart_item_status
      when 'verified' then 'verified'::public.cart_item_status
      when 'rejected' then 'rejected'::public.cart_item_status
      when 'needs_cleaning' then 'needs_cleaning'::public.cart_item_status
      else 'in_cart'::public.cart_item_status
    end
  );

alter table public.cart_items
  alter column status set default 'in_cart'::public.cart_item_status;

comment on type public.cart_item_status is
  'Statut ligne panier : réservation (in_cart, reservation_pending, reserved), cycle retour (verification_pending, verified, rejected, needs_cleaning), archived.';

comment on column public.cart_items.status is
  'Statut ligne panier (enum cart_item_status).';

-- Données existantes : paniers confirmés encore en in_cart / items disponibles.
update public.cart_items ci
set
  status = 'reserved'::public.cart_item_status,
  updated_at = now()
from public.carts c
where c.id = ci.cart_id
  and c.deleted_at is null
  and ci.deleted_at is null
  and c.status = 'confirmed'::public.cart_status
  and ci.status in (
    'in_cart'::public.cart_item_status,
    'reservation_pending'::public.cart_item_status,
    'reserved'::public.cart_item_status
  );

update public.items i
set
  status = 'reserved'::public.item_status,
  updated_at = now()
from public.cart_items ci
join public.carts c on c.id = ci.cart_id
where c.deleted_at is null
  and ci.deleted_at is null
  and c.status = 'confirmed'::public.cart_status
  and ci.status = 'reserved'::public.cart_item_status
  and ci.item_id = i.id
  and i.deleted_at is null
  and i.status in (
    'available'::public.item_status,
    'listed'::public.item_status,
    'in_cart'::public.item_status
  );

create or replace function public.confirm_cart_paid_from_stripe(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_delivery_channel text,
  p_relay_point_id text,
  p_delivery_line1 text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status public.cart_status;
  v_ship_id uuid;
  v_channel text := lower(coalesce(nullif(trim(p_delivery_channel), ''), 'relay'));
begin
  if p_cart_id is null or p_user_id is null then
    raise exception 'cart_id and user_id are required';
  end if;

  select c.status
    into v_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'Cart not found';
  end if;

  if exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.user_id is distinct from p_user_id
  ) then
    raise exception 'Forbidden: cart does not belong to user';
  end if;

  if v_status = 'confirmed'::public.cart_status then
    -- Idempotence + réparation (anciens flux sans mise à jour items / lignes).
    update public.cart_items ci
    set
      status = 'reserved'::public.cart_item_status,
      updated_at = now()
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.status in (
        'in_cart'::public.cart_item_status,
        'reservation_pending'::public.cart_item_status,
        'reserved'::public.cart_item_status
      );

    update public.items i
    set
      status = 'reserved'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.item_id = i.id
      and i.deleted_at is null
      and ci.status = 'reserved'::public.cart_item_status;

    return jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'cart_id', p_cart_id
    );
  end if;

  if v_status is distinct from 'checkout_pending'::public.cart_status
     and v_status is distinct from 'active'::public.cart_status then
    raise exception 'Cart cannot be confirmed from status: %', v_status;
  end if;

  delete from public.item_inventory_locks il
  where il.cart_id = p_cart_id;

  update public.carts c
  set
    status = 'confirmed'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    v_status,
    'confirmed'::public.cart_status,
    'stripe_checkout_paid',
    p_user_id
  );

  -- Paiement validé : réserver les pièces (items + lignes panier pré-expédition).
  update public.cart_items ci
  set
    status = 'reserved'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.status in (
      'in_cart'::public.cart_item_status,
      'reservation_pending'::public.cart_item_status,
      'reserved'::public.cart_item_status
    );

  update public.items i
  set
    status = 'reserved'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and ci.status = 'reserved'::public.cart_item_status;

  if not exists (
    select 1
    from public.shipments s
    where s.cart_id = p_cart_id
      and s.context = 'cart_outbound'::public.shipment_context
      and s.deleted_at is null
  ) then
    insert into public.shipments (cart_id, context, status)
    values (p_cart_id, 'cart_outbound'::public.shipment_context, 'pending'::public.shipment_status)
    returning id into v_ship_id;

    insert into public.shipment_items (shipment_id, cart_item_id)
    select v_ship_id, ci.id
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null;

    if v_channel = 'relay' and coalesce(nullif(trim(p_relay_point_id), ''), '') <> '' then
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        provider_point_id,
        metadata
      )
      values (
        v_ship_id,
        'pickup_point'::public.shipment_destination_type,
        nullif(trim(p_relay_point_id), ''),
        jsonb_build_object(
          'stripe_checkout_session_id', p_checkout_session_id,
          'source', 'stripe_cart_order'
        )
      );
    elsif v_channel = 'home' then
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        line1,
        metadata
      )
      values (
        v_ship_id,
        'home'::public.shipment_destination_type,
        coalesce(nullif(trim(p_delivery_line1), ''), 'Livraison à domicile (checkout)'),
        jsonb_build_object(
          'stripe_checkout_session_id', p_checkout_session_id,
          'source', 'stripe_cart_order'
        )
      );
    else
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        provider_point_id,
        metadata
      )
      values (
        v_ship_id,
        'pickup_point'::public.shipment_destination_type,
        null,
        jsonb_build_object(
          'stripe_checkout_session_id', p_checkout_session_id,
          'source', 'stripe_cart_order',
          'note', 'relay_point_missing'
        )
      );
    end if;
  end if;

  perform public.log_activity_event_rpc(
    'cart_confirmed_stripe',
    'stripe_checkout_paid',
    p_user_id,
    'cart'::public.activity_resource_type,
    'cart',
    p_cart_id,
    'info'::public.activity_severity,
    jsonb_build_object(
      'cart_id', p_cart_id,
      'checkout_session_id', p_checkout_session_id,
      'delivery_channel', v_channel
    ),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'shipment_id', v_ship_id
  );
end;
$fn$;

comment on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text) is
  'Payé sur Stripe : panier checkout_pending|active → confirmed, lignes pré-expédition + items → reserved, shipment cart_outbound. Idempotent ; réparation reserved si déjà confirmed.';
