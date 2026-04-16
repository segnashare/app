-- Garde-fou « invité » (sans abonnement Membre +/X ni rôle membre) : aucun crédit d’échange.
-- Aligné sur public.user_can_reserve_cart_inventory (même définition que le panier / Guest).
-- Couvre les insertions service_role / backoffice : triggers + RPC.

-- ---------------------------------------------------------------------------
-- Privilèges : les triggers security definer invoquent user_can_reserve_cart_inventory
-- ---------------------------------------------------------------------------

grant execute on function public.user_can_reserve_cart_inventory(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- user_wallets : ne jamais matérialiser l’échange pour un invité ; fusion conso
-- ---------------------------------------------------------------------------

create or replace function public.user_wallets_sync_balance_points_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $trg$
declare
  v_can_exchange boolean;
begin
  v_can_exchange := public.user_can_reserve_cart_inventory(new.user_id);

  if tg_op = 'INSERT' then
    if coalesce(new.balance_consumption_points, 0) = 0
       and coalesce(new.balance_exchange_points, 0) = 0
       and coalesce(new.balance_points, 0) > 0 then
      if v_can_exchange then
        new.balance_exchange_points := greatest(0::bigint, coalesce(new.balance_points, 0)::bigint);
        new.balance_consumption_points := 0;
      else
        new.balance_consumption_points := greatest(0::bigint, coalesce(new.balance_points, 0)::bigint);
        new.balance_exchange_points := null;
      end if;
    end if;
  end if;

  if not v_can_exchange then
    new.balance_consumption_points :=
      coalesce(new.balance_consumption_points, 0) + coalesce(new.balance_exchange_points, 0);
    new.balance_exchange_points := null;
  end if;

  new.balance_points :=
    coalesce(new.balance_consumption_points, 0) + coalesce(new.balance_exchange_points, 0);
  return new;
end;
$trg$;

comment on function public.user_wallets_sync_balance_points_total() is
  'Recalcule balance_points ; invités (sans user_can_reserve_cart_inventory) : tout en consommation, balance_exchange_points NULL.';

-- ---------------------------------------------------------------------------
-- wallet_transactions : interdit exchange / mixed et crédits « prêt » pour invité
-- ---------------------------------------------------------------------------

create or replace function public.wallet_transactions_enforce_guest_exchange_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_can_exchange boolean;
  v_bucket text;
  v_kind text;
  v_src text;
begin
  if new.user_id is null then
    return new;
  end if;

  v_can_exchange := public.user_can_reserve_cart_inventory(new.user_id);
  if v_can_exchange then
    return new;
  end if;

  v_bucket := lower(trim(coalesce(new.credit_bucket, '')));
  v_kind := lower(trim(coalesce(new.metadata->>'credits_kind', '')));
  v_src := lower(trim(coalesce(new.metadata->>'source', '')));

  if v_bucket in ('exchange', 'mixed') then
    raise exception 'GUEST_WALLET_EXCHANGE_BUCKET_FORBIDDEN'
      using hint = 'credit_bucket exchange/mixed is not allowed for guest users';
  end if;

  if new.kind = 'credit' and new.direction = 'credit' then
    if v_kind in ('exchange', 'mods') then
      raise exception 'GUEST_WALLET_EXCHANGE_METADATA_FORBIDDEN'
        using hint = 'credits_kind exchange/mods is not allowed for guest users';
    end if;
    if v_src = 'lend_intake_verified' then
      raise exception 'GUEST_WALLET_LEND_INTAKE_CREDIT_FORBIDDEN'
        using hint = 'lend_intake_verified credits are not allowed for guest users';
    end if;
  end if;

  return new;
end;
$fn$;

comment on function public.wallet_transactions_enforce_guest_exchange_rules() is
  'Bloque pour les invités les lignes wallet en exchange/mixed et les crédits prêt (lend_intake_verified).';

drop trigger if exists trg_wallet_transactions_enforce_guest_exchange_rules on public.wallet_transactions;

create trigger trg_wallet_transactions_enforce_guest_exchange_rules
before insert or update on public.wallet_transactions
for each row
execute function public.wallet_transactions_enforce_guest_exchange_rules();

-- ---------------------------------------------------------------------------
-- wallet_credit_purchase : erreur explicite avant insert
-- ---------------------------------------------------------------------------

create or replace function public.wallet_credit_purchase(
  p_user_id uuid,
  p_amount_points bigint,
  p_credit_kind text,
  p_provider text default 'stripe',
  p_checkout_session_id text default null,
  p_payment_intent_id text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_kind text;
  v_effective_provider text;
  v_effective_idempotency_key text;
  v_metadata jsonb;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_total bigint;
  v_new_co bigint;
  v_new_ex bigint;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount_points is null or p_amount_points <= 0 then
    raise exception 'p_amount_points must be > 0';
  end if;

  v_effective_kind := lower(trim(coalesce(p_credit_kind, '')));
  if v_effective_kind in ('pods', 'consommation') then
    v_effective_kind := 'consumption';
  elsif v_effective_kind = 'mods' then
    v_effective_kind := 'exchange';
  end if;
  if v_effective_kind not in ('consumption', 'exchange') then
    raise exception 'Invalid p_credit_kind: %', p_credit_kind;
  end if;

  if v_effective_kind = 'exchange' and not public.user_can_reserve_cart_inventory(p_user_id) then
    raise exception 'GUEST_EXCHANGE_CREDIT_PURCHASE_NOT_ALLOWED';
  end if;

  v_effective_provider := lower(coalesce(nullif(p_provider, ''), 'stripe'));

  v_effective_idempotency_key := coalesce(
    nullif(p_idempotency_key, ''),
    case
      when p_checkout_session_id is not null and p_checkout_session_id <> '' then format('%s:credits_purchase:%s', v_effective_provider, p_checkout_session_id)
      else null
    end
  );

  if v_effective_idempotency_key is null then
    raise exception 'p_idempotency_key or p_checkout_session_id is required';
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'credits_purchase',
      'provider', v_effective_provider,
      'credits_kind', v_effective_kind,
      'checkout_session_id', p_checkout_session_id,
      'payment_intent_id', p_payment_intent_id
    );

  insert into public.wallet_transactions (
    user_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata,
    credit_bucket
  )
  values (
    p_user_id,
    'credit',
    'credit',
    p_amount_points,
    'posted',
    v_effective_idempotency_key,
    v_metadata,
    v_effective_kind
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    select uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
      into v_wallet_id, v_new_total, v_new_co, v_new_ex
    from public.user_wallets uw
    where uw.user_id = p_user_id
      and uw.deleted_at is null
    order by uw.updated_at desc
    limit 1;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_new_total, 0),
      'new_balance_consumption_points', coalesce(v_new_co, 0),
      'new_balance_exchange_points', coalesce(v_new_ex, 0),
      'idempotency_key', v_effective_idempotency_key
    );
  end if;

  update public.user_wallets uw
     set
       balance_consumption_points = uw.balance_consumption_points
         + case when v_effective_kind = 'consumption' then p_amount_points else 0 end,
       balance_exchange_points = case
         when v_effective_kind = 'exchange' then coalesce(uw.balance_exchange_points, 0) + p_amount_points
         else uw.balance_exchange_points
       end,
       updated_at = now()
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = p_user_id
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
    into v_wallet_id, v_new_total, v_new_co, v_new_ex;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (
      p_user_id,
      case when v_effective_kind = 'consumption' then p_amount_points else 0 end,
      case when v_effective_kind = 'exchange' then p_amount_points else null end
    )
    returning id, balance_points, balance_consumption_points, balance_exchange_points
      into v_wallet_id, v_new_total, v_new_co, v_new_ex;
  end if;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'wallet_id', v_wallet_id,
    'new_balance_points', v_new_total,
    'new_balance_consumption_points', v_new_co,
    'new_balance_exchange_points', v_new_ex,
    'transaction_id', v_tx_id,
    'idempotency_key', v_effective_idempotency_key
  );
end;
$$;

revoke all on function public.wallet_credit_purchase(
  uuid, bigint, text, text, text, text, text, jsonb
) from public;
grant execute on function public.wallet_credit_purchase(
  uuid, bigint, text, text, text, text, text, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- Crédit prêt vérifié : pas de wallet pour invité (l’état intake reste appliqué)
-- ---------------------------------------------------------------------------

create or replace function public.item_intake_after_verified_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_points bigint;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_total bigint;
  v_new_co bigint;
  v_new_ex bigint;
  v_key text;
begin
  if new.listing_stage::text <> 'validated'
     or new.fulfillment_stage::text <> 'verified' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.listing_stage::text = 'validated'
       and old.fulfillment_stage::text = 'verified' then
      return new;
    end if;
  end if;

  select i.owner_user_id, coalesce(i.price_points, 0)::bigint
    into v_owner, v_points
  from public.items i
  where i.id = new.item_id
    and i.deleted_at is null;

  if v_owner is null or v_points <= 0 then
    return new;
  end if;

  if not public.user_can_reserve_cart_inventory(v_owner) then
    return new;
  end if;

  v_key := 'intake_verified_lend_credit:' || new.item_id::text;

  insert into public.wallet_transactions (
    user_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata,
    credit_bucket
  )
  values (
    v_owner,
    'credit',
    'credit',
    v_points,
    'posted',
    v_key,
    jsonb_build_object(
      'source', 'lend_intake_verified',
      'item_id', new.item_id
    ),
    'exchange'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    return new;
  end if;

  update public.user_wallets uw
     set
       balance_exchange_points = coalesce(uw.balance_exchange_points, 0) + v_points,
       updated_at = now()
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = v_owner
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
    into v_wallet_id, v_new_total, v_new_co, v_new_ex;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (v_owner, 0, v_points)
    returning id, balance_points, balance_consumption_points, balance_exchange_points
      into v_wallet_id, v_new_total, v_new_co, v_new_ex;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remboursements retour / annulation : reclasser exchange → consommation pour invité
-- ---------------------------------------------------------------------------

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
      where ci.status = 'verified'::public.cart_item_status
    )
    into v_pending, v_rejected, v_ok_lines
  from public.cart_items ci
  where ci.cart_id = v_cart_id
    and ci.deleted_at is null
    and ci.status in (
      'reserved'::public.cart_item_status,
      'verification_pending'::public.cart_item_status,
      'verified'::public.cart_item_status,
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
    and ci.status = 'verified'::public.cart_item_status;

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
  'Retour BO : clôture retour (voir migration post_clean). service_role uniquement.';

revoke all on function public.close_cart_return_verification_ok(uuid, uuid) from public;
grant execute on function public.close_cart_return_verification_ok(uuid, uuid) to service_role;

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

-- ---------------------------------------------------------------------------
-- Données : fusionner tout solde « échange » résiduel pour les invités
-- ---------------------------------------------------------------------------

update public.user_wallets uw
set
  balance_consumption_points =
    coalesce(uw.balance_consumption_points, 0) + coalesce(uw.balance_exchange_points, 0),
  balance_exchange_points = null
where uw.deleted_at is null
  and not public.user_can_reserve_cart_inventory(uw.user_id)
  and coalesce(uw.balance_exchange_points, 0) <> 0;

update public.user_wallets uw
set
  balance_consumption_points = uw.balance_consumption_points,
  balance_exchange_points = uw.balance_exchange_points;
