-- Remboursement wallet quand une commande panier (débit `cart_order_stripe`) disparaît sans passer par
-- `member_cancel_cart_order_pending_preparation` (ex. DELETE manuel sur `carts`).
-- Idempotent : mêmes `idempotency_key` que l’annulation membre (`cart_order_cancel_refund_ex|co:{cart_id}`).
--
-- Réparation rétroactive (panier déjà supprimé) : en service_role,
--   select public.refund_wallet_cart_order_stripe_debit_by_cart_id('<cart_id>'::uuid);
-- Le `cart_id` se lit sur la ligne débit : metadata->>'cart_id' où metadata->>'source' = 'cart_order_stripe'.

create or replace function public.refund_wallet_cart_order_stripe_debit_by_cart_id(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_debit_id uuid;
  v_uid uuid;
  v_debit_amount bigint;
  v_debit_meta jsonb;
  v_debit_bucket text;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_split jsonb;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
begin
  if p_cart_id is null then
    return jsonb_build_object('ok', false, 'error', 'cart_id_required');
  end if;

  select wt.id, wt.user_id, wt.amount_points, wt.metadata, wt.credit_bucket
    into v_debit_id, v_uid, v_debit_amount, v_debit_meta, v_debit_bucket
  from public.wallet_transactions wt
  where wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata->>'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata->>'cart_id'), '') is not null
    and (wt.metadata->>'cart_id')::uuid = p_cart_id
  order by wt.created_at desc
  limit 1;

  if v_debit_id is null then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'no_cart_order_stripe_debit',
      'cart_id', p_cart_id
    );
  end if;

  v_split := v_debit_meta->'debit_split';
  if v_split is not null and jsonb_typeof(v_split) = 'object' then
    v_ex := greatest(0::bigint, coalesce((v_split->>'exchange_points')::bigint, 0));
    v_co := greatest(0::bigint, coalesce((v_split->>'consumption_points')::bigint, 0));
  else
    if v_debit_bucket = 'exchange' then
      v_ex := greatest(0::bigint, v_debit_amount);
    elsif v_debit_bucket = 'consumption' then
      v_co := greatest(0::bigint, v_debit_amount);
    else
      v_ex := greatest(0::bigint, v_debit_amount);
    end if;
  end if;

  if v_ex + v_co <= 0 then
    return jsonb_build_object('ok', false, 'error', 'cart_debit_zero_split', 'cart_id', p_cart_id, 'debit_wallet_tx', v_debit_id);
  end if;

  if v_ex + v_co <> v_debit_amount then
    return jsonb_build_object('ok', false, 'error', 'cart_debit_split_mismatch', 'cart_id', p_cart_id, 'debit_wallet_tx', v_debit_id);
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
        'refunds_debit_wallet_tx', v_debit_id,
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
        'refunds_debit_wallet_tx', v_debit_id,
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
      'debit_wallet_tx', v_debit_id
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
    'debit_wallet_tx', v_debit_id,
    'refunded_exchange_points', case when v_did_ex then v_ex else 0 end,
    'refunded_consumption_points', case when v_did_co then v_co else 0 end,
    'wallet_row_id', v_wallet_id
  );
end;
$fn$;

comment on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) is
  'Recredite wallet from last cart_order_stripe debit for cart_id; idempotent cancel keys; service_role or DELETE trigger.';

revoke all on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) from public;
grant execute on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Déclencheur : suppression physique du panier (maintenance / SQL)
-- ---------------------------------------------------------------------------

create or replace function public.carts_before_delete_refund_wallet_stripe_debit()
returns trigger
language plpgsql
security definer
set search_path = public
as $trg$
begin
  perform public.refund_wallet_cart_order_stripe_debit_by_cart_id(old.id);
  return old;
end;
$trg$;

comment on function public.carts_before_delete_refund_wallet_stripe_debit() is
  'Before DELETE on carts: refund cart_order_stripe wallet debit if any (idempotent).';

drop trigger if exists trg_carts_before_delete_refund_wallet_stripe_debit on public.carts;

create trigger trg_carts_before_delete_refund_wallet_stripe_debit
before delete on public.carts
for each row
execute function public.carts_before_delete_refund_wallet_stripe_debit();
