-- Utilise `sold` : confirm achat → sold ; cancel libère sold|reserved ; marketing + guards.

-- ---------------------------------------------------------------------------
-- confirm_cart_paid_from_stripe : reserved (location) vs sold (achat)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_cart_paid_from_stripe(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_delivery_channel text,
  p_relay_point_id text,
  p_delivery_line1 text,
  p_return_relay_point_id text default null,
  p_return_relay_label text default null,
  p_return_relay_search_postal_code text default null,
  p_used_included_order boolean default false
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
  v_dest_meta jsonb;
  v_purchase boolean := false;
  v_item_status public.item_status;
begin
  if p_cart_id is null or p_user_id is null then
    raise exception 'cart_id and user_id are required';
  end if;

  v_dest_meta := jsonb_build_object(
    'stripe_checkout_session_id', p_checkout_session_id,
    'source', 'stripe_cart_order'
  );
  if coalesce(nullif(trim(p_return_relay_point_id), ''), '') <> '' then
    v_dest_meta := v_dest_meta || jsonb_strip_nulls(
      jsonb_build_object(
        'return_relay_code', nullif(trim(p_return_relay_point_id), ''),
        'return_relay_label', nullif(trim(p_return_relay_label), ''),
        'return_relay_search_postal_code', nullif(trim(p_return_relay_search_postal_code), '')
      )
    );
  end if;

  select
    c.status,
    (
      c.checkout_purchase_mode is true
      or exists (
        select 1
        from public.cart_order_stripe_invoices inv
        where inv.cart_id = c.id
          and nullif(trim(inv.guest_purchase_stripe_invoice_id), '') is not null
      )
    )
    into v_status, v_purchase
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

  v_item_status := case
    when coalesce(v_purchase, false) then 'sold'::public.item_status
    else 'reserved'::public.item_status
  end;

  if v_status = 'confirmed'::public.cart_status then
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
      status = v_item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.item_id = i.id
      and i.deleted_at is null
      and ci.status = 'reserved'::public.cart_item_status;

    if coalesce(nullif(trim(p_return_relay_point_id), ''), '') <> '' then
      update public.shipment_destinations sd
      set
        metadata = coalesce(sd.metadata, '{}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'return_relay_code', nullif(trim(p_return_relay_point_id), ''),
            'return_relay_label', nullif(trim(p_return_relay_label), ''),
            'return_relay_search_postal_code', nullif(trim(p_return_relay_search_postal_code), '')
          )
        ),
        updated_at = now()
      from public.shipments s
      where sd.shipment_id = s.id
        and s.cart_id = p_cart_id
        and s.context = 'cart_outbound'::public.shipment_context
        and s.deleted_at is null;
    end if;

    perform public.confirm_cart_try_monthly_orders_used_bump(p_cart_id, p_user_id, p_used_included_order);

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
    status = v_item_status,
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
        v_dest_meta
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
        v_dest_meta
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
        v_dest_meta || jsonb_build_object('note', 'relay_point_missing')
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
      'delivery_channel', v_channel,
      'used_included_order', coalesce(p_used_included_order, false),
      'purchase_mode', coalesce(v_purchase, false),
      'item_status', v_item_status::text
    ),
    null
  );

  perform public.confirm_cart_try_monthly_orders_used_bump(p_cart_id, p_user_id, p_used_included_order);

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'shipment_id', v_ship_id
  );
end;
$fn$;

revoke all on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Cancel + reserve guard + competition : patch chirurgical (corps live inchangé)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  def text;
  new_def text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'member_cancel_cart_order_pending_preparation',
        'backoffice_cancel_cart_order_pending_preparation',
        'reserve_cart_atomic'
      )
  loop
    def := pg_get_functiondef(r.oid);
    new_def := def;
    if position('and i.status = ''reserved''::public.item_status' in new_def) > 0 then
      new_def := replace(
        new_def,
        'and i.status = ''reserved''::public.item_status',
        'and i.status in (''reserved''::public.item_status, ''sold''::public.item_status)'
      );
    end if;
    if new_def is distinct from def then
      execute new_def;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Compétition panier : reserved_by_other inclut sold
-- ---------------------------------------------------------------------------
create or replace function public.get_cart_items_competition_state(p_item_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with uid as (
    select auth.uid() as viewer_id
  ),
  ids as (
    select distinct x as item_id
    from unnest(coalesce(p_item_ids, array[]::uuid[])) as t(x)
    where x is not null
  ),
  agg as (
    select
      i.item_id,
      (
        select count(*)::int
        from public.cart_items ci
        join public.carts c on c.id = ci.cart_id
        cross join uid u
        where ci.item_id = i.item_id
          and ci.deleted_at is null
          and ci.status = 'in_cart'
          and c.deleted_at is null
          and c.user_id is distinct from u.viewer_id
          and c.status in ('active'::public.cart_status, 'checkout_pending'::public.cart_status)
      ) as other_shoppers_in_cart,
      coalesce(
        (
          select
            (coalesce(it.status::text, '') in ('reserved', 'sold')
             and not exists (
               select 1
               from public.cart_items ci2
               join public.carts c2 on c2.id = ci2.cart_id
               cross join uid u2
               where ci2.item_id = i.item_id
                 and ci2.deleted_at is null
                 and ci2.status = 'reserved'
                 and c2.user_id = u2.viewer_id
             ))
          from public.items it
          where it.id = i.item_id
            and it.deleted_at is null
        ),
        false
      ) as reserved_by_other,
      (
        select max(sub.t)
        from (
          select c.locked_until as t
          from public.cart_items ci
          join public.carts c on c.id = ci.cart_id
          cross join uid u
          where ci.item_id = i.item_id
            and ci.deleted_at is null
            and ci.status = 'reserved'
            and c.deleted_at is null
            and c.user_id is distinct from u.viewer_id
            and c.status = 'checkout_pending'::public.cart_status
            and c.locked_until is not null
        ) sub
        where sub.t is not null
      ) as reserved_until_at
    from ids i
    cross join uid u0
    where u0.viewer_id is not null
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'item_id', a.item_id,
          'other_shoppers_in_cart', a.other_shoppers_in_cart,
          'reserved_by_other', a.reserved_by_other,
          'reserved_until_at', a.reserved_until_at
        )
        order by a.item_id
      )
      from agg a
    ),
    '[]'::jsonb
  );
$function$;

-- ---------------------------------------------------------------------------
-- Marketing RPCs : inclure sold dans les filtres statut catalogue
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  def text;
  new_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'get_marketing_website_catalog%'
  loop
    def := pg_get_functiondef(r.oid);
    if position('''sold''::public.item_status' in def) = 0
       and position('''reserved''::public.item_status' in def) > 0 then
      new_def := replace(
        def,
        '''reserved''::public.item_status',
        '''reserved''::public.item_status,' || e'\n        ''sold''::public.item_status'
      );
      execute new_def;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill : pièces déjà achetées encore en reserved → sold
-- ---------------------------------------------------------------------------
update public.items i
set
  status = 'sold'::public.item_status,
  updated_at = timezone('utc', now())
where i.deleted_at is null
  and i.status = 'reserved'::public.item_status
  and exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    left join public.cart_order_stripe_invoices inv on inv.cart_id = c.id
    where ci.item_id = i.id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('confirmed'::public.cart_status, 'archived'::public.cart_status)
      and (
        c.checkout_purchase_mode is true
        or nullif(trim(inv.guest_purchase_stripe_invoice_id), '') is not null
      )
  );
