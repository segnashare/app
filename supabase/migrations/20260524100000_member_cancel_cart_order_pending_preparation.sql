-- Annulation membre : tant que l’expédition aller est `pending` (en préparation), sans paiement Stripe enregistré.
-- Rembourse les crédits (échange / consommation) d’après le débit panier, repasse les pièces en `listed`, panier → canceled.

create or replace function public.member_cancel_cart_order_pending_preparation(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_cart_status public.cart_status;
  v_ship_id uuid;
  v_ship_status public.shipment_status;
  v_debit record;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_split jsonb;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
  v_sub_plan text;
  v_sub_status text;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_cart_id is null then
    raise exception 'cart_id is required';
  end if;

  select c.user_id, c.status
    into v_owner, v_cart_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'CART_NOT_FOUND';
  end if;

  if v_owner is distinct from v_uid then
    raise exception 'FORBIDDEN';
  end if;

  if v_cart_status = 'canceled'::public.cart_status then
    return jsonb_build_object('ok', true, 'already_canceled', true, 'cart_id', p_cart_id);
  end if;

  if v_cart_status is distinct from 'confirmed'::public.cart_status then
    raise exception 'CART_NOT_CANCELLABLE_STATUS:%', v_cart_status;
  end if;

  if exists (
    select 1
    from public.cart_order_stripe_invoices i
    where i.cart_id = p_cart_id
      and coalesce(i.amount_total_cents, 0) > 0
  ) then
    raise exception 'CART_CANCEL_STRIPE_PAYMENT_RECORDED';
  end if;

  select s.id, s.status
    into v_ship_id, v_ship_status
  from public.shipments s
  where s.cart_id = p_cart_id
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;

  if v_ship_id is null then
    raise exception 'OUTBOUND_SHIPMENT_NOT_FOUND';
  end if;

  if v_ship_status is distinct from 'pending'::public.shipment_status then
    raise exception 'SHIPMENT_NOT_PENDING:%', v_ship_status;
  end if;

  select wt.id, wt.amount_points, wt.metadata, wt.credit_bucket
    into v_debit
  from public.wallet_transactions wt
  where wt.user_id = v_uid
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata->>'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata->>'cart_id'), '') is not null
    and (wt.metadata->>'cart_id')::uuid = p_cart_id
  order by wt.created_at desc
  limit 1;

  if not found then
    raise exception 'CART_DEBIT_NOT_FOUND';
  end if;

  v_split := v_debit.metadata->'debit_split';
  if v_split is not null and jsonb_typeof(v_split) = 'object' then
    v_ex := greatest(0::bigint, coalesce((v_split->>'exchange_points')::bigint, 0));
    v_co := greatest(0::bigint, coalesce((v_split->>'consumption_points')::bigint, 0));
  else
    if v_debit.credit_bucket = 'exchange' then
      v_ex := greatest(0::bigint, v_debit.amount_points);
    elsif v_debit.credit_bucket = 'consumption' then
      v_co := greatest(0::bigint, v_debit.amount_points);
    elsif v_debit.credit_bucket = 'mixed' then
      raise exception 'CART_DEBIT_MIXED_WITHOUT_SPLIT';
    else
      v_ex := greatest(0::bigint, v_debit.amount_points);
    end if;
  end if;

  if v_ex + v_co <= 0 then
    raise exception 'CART_DEBIT_ZERO_SPLIT';
  end if;

  if v_ex + v_co <> v_debit.amount_points then
    raise exception 'CART_DEBIT_SPLIT_MISMATCH';
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
        'refunds_debit_wallet_tx', v_debit.id,
        'credits_kind', 'exchange'
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
        'refunds_debit_wallet_tx', v_debit.id,
        'credits_kind', 'consumption'
      ),
      'consumption'
    );
    v_did_co := true;
  end if;

  if v_did_ex or v_did_co then
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
  end if;

  update public.items i
  set
    status = 'listed'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and i.status = 'reserved'::public.item_status;

  update public.cart_items ci
  set
    status = 'archived'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  update public.shipments s
  set
    status = 'closed'::public.shipment_status,
    updated_at = now()
  where s.id = v_ship_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    'confirmed'::public.cart_status,
    'canceled'::public.cart_status,
    'member_cancel_pending_preparation',
    v_uid
  );

  update public.carts c
  set
    status = 'canceled'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  select s.plan_code, s.status
    into v_sub_plan, v_sub_status
  from public.user_subscriptions s
  where s.user_id = v_uid
    and s.provider = 'stripe'
  order by s.updated_at desc
  limit 1;

  if v_sub_status in ('active', 'trialing')
     and v_sub_plan in ('segna_plus', 'segna_x') then
    update public.user_monthly_entitlements e
    set
      orders_used = greatest(0, e.orders_used - 1),
      updated_at = now()
    where e.user_id = v_uid
      and e.period_month = v_period_month
      and e.orders_used > 0;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'refunded_exchange_points', v_ex,
    'refunded_consumption_points', v_co
  );
end;
$fn$;

comment on function public.member_cancel_cart_order_pending_preparation(uuid) is
  $cmt$
Membre : annule une commande confirmée tant que l’expédition aller est pending, sans facture Stripe (montant > 0).
Rembourse crédits, items → listed, panier canceled.
$cmt$;

revoke all on function public.member_cancel_cart_order_pending_preparation(uuid) from public;
grant execute on function public.member_cancel_cart_order_pending_preparation(uuid) to authenticated;

-- Lecture du débit panier côté app (répartition affichée sur la fiche commande).
alter table public.wallet_transactions enable row level security;

drop policy if exists wallet_transactions_select_own on public.wallet_transactions;
create policy wallet_transactions_select_own on public.wallet_transactions
  for select to authenticated
  using (user_id = auth.uid());
