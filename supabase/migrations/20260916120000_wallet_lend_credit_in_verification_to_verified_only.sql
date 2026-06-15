-- Crédit prêt : uniquement à la transition in_verification → verified (pas depuis shipping/ready).

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

    if old.fulfillment_stage::text <> 'in_verification' then
      return new;
    end if;
  else
    -- Pas de crédit sur INSERT direct en verified (hors transition contrôlée).
    return new;
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

comment on function public.item_intake_after_verified_wallet_credit() is
  'Credite le wallet du proprietaire (idempotent) quand intake validated passe de in_verification a verified.';
