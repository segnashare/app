-- Annule le crédit prêteur (lend_intake_verified) quand une pièce repart en préparation d'envoi
-- (ex. retirée du colis déposé, réaffectée à un nouveau transfer).

create or replace function public.wallet_reverse_lend_intake_verified_credit(
  p_item_id uuid,
  p_reason text default 'intake_fulfillment_reset'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_points bigint;
  v_credit_key text;
  v_debit_key text;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_total bigint;
  v_new_co bigint;
  v_new_ex bigint;
begin
  if p_item_id is null then
    return jsonb_build_object('applied', false, 'reason', 'missing_item_id');
  end if;

  v_credit_key := 'intake_verified_lend_credit:' || p_item_id::text;
  v_debit_key := 'intake_lend_credit_reversal:' || p_item_id::text;

  select i.owner_user_id, coalesce(i.price_points, 0)::bigint
    into v_owner, v_points
  from public.items i
  where i.id = p_item_id
    and i.deleted_at is null;

  if v_owner is null then
    return jsonb_build_object('applied', false, 'reason', 'item_not_found');
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

  if exists (
    select 1
    from public.wallet_transactions wt
    where wt.idempotency_key = v_debit_key
      and wt.user_id = v_owner
      and wt.direction = 'debit'
      and wt.status = 'posted'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'already_reversed');
  end if;

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
    'debit',
    'debit',
    v_points,
    'posted',
    v_debit_key,
    jsonb_build_object(
      'source', 'lend_intake_verified_reversal',
      'item_id', p_item_id,
      'reason', coalesce(nullif(btrim(p_reason), ''), 'intake_fulfillment_reset')
    ),
    'exchange'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    return jsonb_build_object('applied', false, 'reason', 'duplicate', 'idempotency_key', v_debit_key);
  end if;

  update public.user_wallets uw
     set
       balance_exchange_points = greatest(0::bigint, coalesce(uw.balance_exchange_points, 0::bigint) - v_points),
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

  return jsonb_build_object(
    'applied', true,
    'reason', 'ok',
    'amount_points', v_points,
    'wallet_id', v_wallet_id,
    'new_balance_points', coalesce(v_new_total, 0),
    'new_balance_exchange_points', coalesce(v_new_ex, 0)
  );
end;
$$;

comment on function public.wallet_reverse_lend_intake_verified_credit(uuid, text) is
  'Débit idempotent du crédit prêt (intake_lend_credit_reversal:{item_id}) si lend_intake_verified a été versé.';

revoke all on function public.wallet_reverse_lend_intake_verified_credit(uuid, text) from public;
grant execute on function public.wallet_reverse_lend_intake_verified_credit(uuid, text) to service_role;
