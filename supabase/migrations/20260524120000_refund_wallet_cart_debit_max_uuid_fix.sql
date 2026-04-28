-- max(uuid) n'existe pas en PostgreSQL (user_id puis id) ; trigger BEFORE DELETE sur carts.
create or replace function public.refund_wallet_cart_order_stripe_debit_by_cart_id(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $rf$
declare
  v_uid uuid;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_debit_anchor_id uuid;
  v_sum_debits bigint;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
begin
  if p_cart_id is null then
    return jsonb_build_object('ok', false, 'error', 'cart_id_required');
  end if;

  select
    (array_agg(wt.user_id order by wt.id desc))[1],
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'consumption' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    (array_agg(wt.id order by wt.id desc))[1],
    coalesce(sum(wt.amount_points), 0::bigint)
  into v_uid, v_ex, v_co, v_debit_anchor_id, v_sum_debits
  from public.wallet_transactions wt
  where wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = p_cart_id;

  if v_uid is null or (v_ex <= 0 and v_co <= 0) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'no_cart_order_stripe_debit',
      'cart_id', p_cart_id
    );
  end if;

  if v_sum_debits <> v_ex + v_co then
    return jsonb_build_object('ok', false, 'error', 'cart_debit_split_mismatch', 'cart_id', p_cart_id);
  end if;

  if not public.user_can_reserve_cart_inventory(v_uid) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  v_key_ex := format('cart_order_cancel_refund_ex:%s', p_cart_id);
  v_key_co := format('cart_order_cancel_refund_co:%s', p_cart_id);

  if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_ex,
      'posted',
      v_key_ex,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'exchange',
        'refund_reason', 'cart_deleted_or_orphan_repair'
      ),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_co,
      'posted',
      v_key_co,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'consumption',
        'refund_reason', 'cart_deleted_or_orphan_repair'
      ),
      'consumption'
    );
    v_did_co := true;
  end if;

  if not v_did_ex and not v_did_co then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'cart_id', p_cart_id,
      'debit_wallet_tx', v_debit_anchor_id
    );
  end if;

  update public.user_wallets uw
  set
    balance_exchange_points = case
      when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex
      else uw.balance_exchange_points
    end,
    balance_consumption_points = case
      when v_did_co then uw.balance_consumption_points + v_co
      else uw.balance_consumption_points
    end,
    updated_at = now()
  where uw.id = (
    select id from public.user_wallets
    where user_id = v_uid and deleted_at is null
    order by updated_at desc
    limit 1
  )
  returning uw.id into v_wallet_id;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (
      v_uid,
      case when v_did_co then v_co else 0 end,
      case when v_did_ex then v_ex else null end
    )
    returning id into v_wallet_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'debit_wallet_tx', v_debit_anchor_id,
    'refunded_exchange_points', case when v_did_ex then v_ex else 0 end,
    'refunded_consumption_points', case when v_did_co then v_co else 0 end,
    'wallet_row_id', v_wallet_id
  );
end;
$rf$;

comment on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) is
  'Recredite wallet from all cart_order_stripe debits for cart_id; idempotent cancel keys; service_role or DELETE trigger.';

revoke all on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) from public;
grant execute on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) to service_role;
