-- Débit wallet (reverse crédit prêt) quand une pièce passe en `retired`, si pas d’emprunt actif.
-- Symétrique de `intake_verified_lend_credit:{item_id}` (item_intake_after_verified_wallet_credit).

create or replace function public.wallet_apply_retired_lend_debit(
  p_item_id uuid,
  p_previous_item_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_points bigint;
  v_item_status text;
  v_busy boolean;
  v_credit_key text;
  v_debit_key text;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_balance bigint;
begin
  if p_item_id is null then
    return jsonb_build_object('applied', false, 'reason', 'missing_item_id');
  end if;

  v_credit_key := 'intake_verified_lend_credit:' || p_item_id::text;
  v_debit_key := 'item_retired_lend_debit:' || p_item_id::text;

  select i.owner_user_id, coalesce(i.price_points, 0)::bigint, i.status::text
    into v_owner, v_points, v_item_status
  from public.items i
  where i.id = p_item_id
    and i.deleted_at is null;

  if v_owner is null then
    return jsonb_build_object('applied', false, 'reason', 'item_not_found');
  end if;

  if auth.role() is distinct from 'service_role' and v_owner is distinct from auth.uid() then
    return jsonb_build_object('applied', false, 'reason', 'forbidden');
  end if;

  if v_item_status <> 'retired' then
    return jsonb_build_object('applied', false, 'reason', 'not_retired', 'status', v_item_status);
  end if;

  if lower(coalesce(p_previous_item_status, '')) in ('reserved', 'in_cart') then
    return jsonb_build_object('applied', false, 'reason', 'borrow_status_previous', 'previous', p_previous_item_status);
  end if;

  select exists (
    select 1
    from public.cart_items ci
    where ci.item_id = p_item_id
      and ci.deleted_at is null
      and ci.status = 'reserved'
  )
  into v_busy;

  if v_busy then
    return jsonb_build_object('applied', false, 'reason', 'cart_reserved_line');
  end if;

  if v_points <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'zero_points');
  end if;

  if not exists (
    select 1
    from public.wallet_transactions wt
    where wt.idempotency_key = v_credit_key
      and wt.user_id = v_owner
      and wt.direction = 'credit'
      and wt.status = 'posted'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'no_prior_lend_credit');
  end if;

  insert into public.wallet_transactions (
    user_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata
  )
  values (
    v_owner,
    'debit',
    'debit',
    v_points,
    'posted',
    v_debit_key,
    jsonb_build_object(
      'source', 'item_retired_lend_reversal',
      'item_id', p_item_id
    )
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    return jsonb_build_object('applied', false, 'reason', 'duplicate', 'idempotency_key', v_debit_key);
  end if;

  update public.user_wallets uw
     set balance_points = greatest(0::bigint, uw.balance_points - v_points),
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

  return jsonb_build_object(
    'applied', true,
    'reason', 'ok',
    'amount_points', v_points,
    'wallet_id', v_wallet_id,
    'new_balance_points', coalesce(v_new_balance, 0)
  );
end;
$$;

comment on function public.wallet_apply_retired_lend_debit(uuid, text) is
  'Débit idempotent (item_retired_lend_debit:{id}) du montant price_points si crédit prêt existe, sans emprunt actif. Réservé service_role ou propriétaire.';

revoke all on function public.wallet_apply_retired_lend_debit(uuid, text) from public;
grant execute on function public.wallet_apply_retired_lend_debit(uuid, text) to service_role;
grant execute on function public.wallet_apply_retired_lend_debit(uuid, text) to authenticated;

create or replace function public.items_after_update_wallet_debit_on_retired()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _r jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status::text <> 'retired' then
    return new;
  end if;

  if old.status::text = 'retired' then
    return new;
  end if;

  _r := public.wallet_apply_retired_lend_debit(new.id, old.status::text);
  return new;
end;
$$;

drop trigger if exists trg_items_after_update_wallet_debit_on_retired on public.items;
create trigger trg_items_after_update_wallet_debit_on_retired
after update of status on public.items
for each row
execute function public.items_after_update_wallet_debit_on_retired();

comment on function public.items_after_update_wallet_debit_on_retired() is
  'Appelle wallet_apply_retired_lend_debit quand items.status devient retired.';
