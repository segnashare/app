-- Crédit wallet + transaction lorsque la pièce est validée annonce + contrôle physique OK (fulfillment verified).
-- Idempotent par item via wallet_transactions.idempotency_key.

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
  v_new_balance bigint;
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

  v_key := 'intake_verified_lend_credit:' || new.item_id::text;

  insert into public.wallet_transactions (
    user_id,
    cart_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata
  )
  values (
    v_owner,
    null,
    'credit',
    'credit',
    v_points,
    'posted',
    v_key,
    jsonb_build_object(
      'source', 'lend_intake_verified',
      'item_id', new.item_id
    )
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    return new;
  end if;

  update public.user_wallets uw
     set balance_points = uw.balance_points + v_points,
         updated_at = now()
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = v_owner
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points into v_wallet_id, v_new_balance;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_points)
    values (v_owner, v_points)
    returning id, balance_points into v_wallet_id, v_new_balance;
  end if;

  return new;
end;
$$;

comment on function public.item_intake_after_verified_wallet_credit() is
  'Credite le wallet du proprietaire une fois (idempotent) quand listing_stage=validated et fulfillment_stage=verified.';

drop trigger if exists trg_item_intake_after_verified_wallet_credit on public.item_intake;

create trigger trg_item_intake_after_verified_wallet_credit
after insert or update of fulfillment_stage, listing_stage on public.item_intake
for each row
execute function public.item_intake_after_verified_wallet_credit();
