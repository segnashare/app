create or replace function public.close_cart_return_verification_ok(
  p_shipment_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_ship record;
  v_cart record;
  v_cart_id uuid;
  v_user_id uuid;
  v_pending int := 0;
  v_rejected int := 0;
  v_ok_lines int := 0;
  v_debit record;
  v_split jsonb;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_key_ex text;
  v_key_co text;
  v_idem_base text;
  v_wallet_id uuid;
  v_w_bco bigint;
  v_w_bex bigint;
  v_did_ex boolean := false;
  v_did_co boolean := false;
  v_now timestamptz := timezone('utc', now());
begin
  if p_shipment_id is null then
    return jsonb_build_object('ok', false, 'error', 'p_shipment_id is required');
  end if;

  select s.id, s.cart_id, s.status, s.context, s.deleted_at
    into v_ship
  from public.shipments s
  where s.id = p_shipment_id
  for update;

  if not found or v_ship.deleted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'SHIPMENT_NOT_FOUND');
  end if;

  if v_ship.context is distinct from 'cart_return'::public.shipment_context then
    return jsonb_build_object('ok', false, 'error', 'NOT_CART_RETURN_SHIPMENT');
  end if;

  if v_ship.status = 'closed'::public.shipment_status then
    return jsonb_build_object('ok', true, 'already_closed', true);
  end if;

  if v_ship.status not in ('returned'::public.shipment_status, 'en_verification'::public.shipment_status) then
    return jsonb_build_object('ok', false, 'error', 'BAD_SHIPMENT_STATUS', 'status', v_ship.status::text);
  end if;

  v_cart_id := v_ship.cart_id;

  select c.id, c.user_id, c.status, c.deleted_at
    into v_cart
  from public.carts c
  where c.id = v_cart_id
  for update;

  if not found or v_cart.deleted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'CART_NOT_FOUND');
  end if;

  v_user_id := v_cart.user_id;

  if v_cart.status = 'archived'::public.cart_status then
    update public.shipments s
    set status = 'closed'::public.shipment_status, updated_at = v_now
    where s.id = p_shipment_id
      and s.status in ('returned'::public.shipment_status, 'en_verification'::public.shipment_status);
    return jsonb_build_object('ok', true, 'already_archived', true);
  end if;

  if v_cart.status is distinct from 'confirmed'::public.cart_status then
    return jsonb_build_object('ok', false, 'error', 'CART_NOT_CONFIRMED', 'status', v_cart.status::text);
  end if;

  select
    count(*) filter (
      where ci.status in (
        'reserved'::public.cart_item_status,
        'verification_pending'::public.cart_item_status
      )
    ),
    count(*) filter (where ci.status = 'rejected'::public.cart_item_status),
    count(*) filter (
      where ci.status in ('verified'::public.cart_item_status, 'needs_cleaning'::public.cart_item_status)
    )
    into v_pending, v_rejected, v_ok_lines
  from public.cart_items ci
  where ci.cart_id = v_cart_id
    and ci.deleted_at is null
    and ci.status in (
      'reserved'::public.cart_item_status,
      'verification_pending'::public.cart_item_status,
      'verified'::public.cart_item_status,
      'needs_cleaning'::public.cart_item_status,
      'rejected'::public.cart_item_status
    );

  if v_pending > 0 then
    return jsonb_build_object('ok', false, 'error', 'PENDING_LINES', 'pending', v_pending);
  end if;

  if v_rejected > 0 then
    return jsonb_build_object('ok', false, 'error', 'HAS_DEFECTS', 'rejected', v_rejected);
  end if;

  if v_ok_lines <= 0 then
    return jsonb_build_object('ok', false, 'error', 'NO_VERIFIED_LINES');
  end if;

  select wt.id, wt.metadata, wt.amount_points, wt.credit_bucket
    into v_debit
  from public.wallet_transactions wt
  where wt.user_id = v_user_id
    and wt.direction = 'debit'
    and coalesce(wt.metadata->>'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata->>'cart_id'), '') is not null
    and (wt.metadata->>'cart_id')::uuid = v_cart_id
  order by wt.created_at desc
  limit 1;

  if found then
    v_split := v_debit.metadata->'debit_split';
    if v_split is not null and jsonb_typeof(v_split) = 'object' then
      v_ex := greatest(0::bigint, coalesce((v_split->>'exchange_points')::bigint, 0));
      v_co := greatest(0::bigint, coalesce((v_split->>'consumption_points')::bigint, 0));
    else
      v_ex := 0;
      v_co := 0;
      if v_debit.credit_bucket = 'exchange' then
        v_ex := greatest(0::bigint, coalesce(v_debit.amount_points, 0));
      elsif v_debit.credit_bucket = 'consumption' then
        v_co := greatest(0::bigint, coalesce(v_debit.amount_points, 0));
      elsif v_debit.credit_bucket = 'mixed' then
        return jsonb_build_object('ok', false, 'error', 'CART_DEBIT_MIXED_WITHOUT_SPLIT');
      else
        v_ex := greatest(0::bigint, coalesce(v_debit.amount_points, 0));
      end if;
    end if;

    if not public.user_can_reserve_cart_inventory(v_user_id) then
      v_co := v_co + v_ex;
      v_ex := 0;
    end if;

    if v_ex > 0 or v_co > 0 then
      v_idem_base := format('return_ok:%s', v_cart_id);
      v_key_ex := v_idem_base || ':ex';
      v_key_co := v_idem_base || ':co';

      select uw.id,
        greatest(0::bigint, coalesce(uw.balance_consumption_points, 0)::bigint),
        greatest(0::bigint, coalesce(uw.balance_exchange_points, 0)::bigint)
        into v_wallet_id, v_w_bco, v_w_bex
      from public.user_wallets uw
      where uw.user_id = v_user_id
        and uw.deleted_at is null
      order by uw.updated_at desc
      limit 1
      for update;

      if v_wallet_id is not null then
        if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
          insert into public.wallet_transactions (
            user_id,
            kind,
            direction,
            amount_points,
            status,
            idempotency_key,
            credit_bucket,
            metadata
          ) values (
            v_user_id,
            'credit',
            'credit',
            v_ex,
            'posted',
            v_key_ex,
            'exchange',
            jsonb_build_object(
              'source', 'return_verification_ok',
              'cart_id', v_cart_id,
              'shipment_id', p_shipment_id,
              'actor_user_id', p_actor_user_id
            )
          );
          v_did_ex := true;
        end if;

        if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
          insert into public.wallet_transactions (
            user_id,
            kind,
            direction,
            amount_points,
            status,
            idempotency_key,
            credit_bucket,
            metadata
          ) values (
            v_user_id,
            'credit',
            'credit',
            v_co,
            'posted',
            v_key_co,
            'consumption',
            jsonb_build_object(
              'source', 'return_verification_ok',
              'cart_id', v_cart_id,
              'shipment_id', p_shipment_id,
              'actor_user_id', p_actor_user_id
            )
          );
          v_did_co := true;
        end if;

        if v_did_ex or v_did_co then
          update public.user_wallets uw
          set
            balance_consumption_points = uw.balance_consumption_points + case when v_did_co then v_co else 0 end,
            balance_exchange_points = case
              when v_did_ex then greatest(0::bigint, coalesce(uw.balance_exchange_points, 0)::bigint) + v_ex
              else uw.balance_exchange_points
            end,
            updated_at = v_now
          where uw.id = v_wallet_id;
        end if;
      end if;
    end if;
  end if;

  update public.carts c
  set status = 'archived'::public.cart_status, updated_at = v_now
  where c.id = v_cart_id
    and c.status = 'confirmed'::public.cart_status;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CART_ARCHIVE_CONFLICT');
  end if;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    v_cart_id,
    'confirmed'::public.cart_status,
    'archived'::public.cart_status,
    'return_verification_ok',
    p_actor_user_id
  );

  update public.cart_items ci
  set status = 'archived'::public.cart_item_status, updated_at = v_now
  where ci.cart_id = v_cart_id
    and ci.deleted_at is null
    and ci.status in ('verified'::public.cart_item_status, 'needs_cleaning'::public.cart_item_status);

  update public.shipments s
  set status = 'closed'::public.shipment_status, updated_at = v_now
  where s.id = p_shipment_id
    and s.status in ('returned'::public.shipment_status, 'en_verification'::public.shipment_status);

  return jsonb_build_object(
    'ok', true,
    'archived', true,
    'cart_id', v_cart_id,
    'shipment_id', p_shipment_id
  );
end;
$fn$;

comment on function public.close_cart_return_verification_ok(uuid, uuid) is
  'Retour BO : toutes les lignes verified/needs_cleaning → crédit wallet idempotent, panier archived, expédition closed. service_role uniquement.';

revoke all on function public.close_cart_return_verification_ok(uuid, uuid) from public;
grant execute on function public.close_cart_return_verification_ok(uuid, uuid) to service_role;
