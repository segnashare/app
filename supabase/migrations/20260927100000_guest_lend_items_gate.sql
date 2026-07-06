-- Guests : location uniquement — prêts réservés aux abonnés actifs (segna_plus / segna_x).

create or replace function public.user_can_lend_items(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_subscriptions s
    where s.user_id = p_user_id
      and s.provider = 'stripe'
      and s.status in ('active', 'trialing')
      and coalesce(s.plan_code, 'guest') in ('segna_plus', 'segna_x')
  );
$$;

comment on function public.user_can_lend_items(uuid) is
  'True si le membre a un abonnement actif Segna+ ou SegnaX (peut prêter des pièces à Segna).';

revoke all on function public.user_can_lend_items(uuid) from public;
grant execute on function public.user_can_lend_items(uuid) to authenticated;
grant execute on function public.user_can_lend_items(uuid) to service_role;

-- Crédit wallet prêt : abonnés uniquement (ne pas utiliser user_can_reserve_cart_inventory).
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

  if not public.user_can_lend_items(v_owner) then
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
  'Credite le wallet exchange du proprietaire abonné quand intake validated passe de in_verification a verified.';

-- Bloque la promotion vers shipping pour les guests (intake déjà validé côté BO).
create or replace function public.enforce_item_intake_lend_membership_on_shipping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if new.fulfillment_stage::text = 'shipping'
     and coalesce(old.fulfillment_stage::text, '') is distinct from 'shipping' then
    select i.owner_user_id into v_owner
    from public.items i
    where i.id = new.item_id
      and i.deleted_at is null;

    if v_owner is not null and not public.user_can_lend_items(v_owner) then
      raise exception 'LEND_NOT_ALLOWED_FOR_GUEST';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_item_intake_enforce_lend_membership_on_shipping on public.item_intake;

create trigger trg_item_intake_enforce_lend_membership_on_shipping
before update of fulfillment_stage on public.item_intake
for each row
execute function public.enforce_item_intake_lend_membership_on_shipping();
