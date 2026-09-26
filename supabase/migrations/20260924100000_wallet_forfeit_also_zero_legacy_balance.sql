-- Le forfeit doit aussi zéroter balance_points (solde legacy), sinon l’UI peut
-- réafficher les crédits via le fallback parseUserWalletPointsRow.

create or replace function public.wallet_forfeit_on_immediate_subscription_cancel(
  p_user_id uuid,
  p_subscription_id text,
  p_source text default 'immediate_cancel'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_co bigint := 0;
  v_ex bigint := 0;
  v_sub text;
  v_src text;
  v_key_co text;
  v_key_ex text;
  v_meta jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  v_sub := nullif(trim(coalesce(p_subscription_id, '')), '');
  if v_sub is null then
    raise exception 'p_subscription_id is required';
  end if;

  v_src := nullif(trim(coalesce(p_source, '')), '');
  if v_src is null then
    v_src := 'immediate_cancel';
  end if;

  select uw.id,
         greatest(0, coalesce(uw.balance_consumption_points, 0))::bigint,
         greatest(0, coalesce(uw.balance_exchange_points, 0))::bigint
    into v_wallet_id, v_co, v_ex
  from public.user_wallets uw
  where uw.user_id = p_user_id
    and uw.deleted_at is null
  order by uw.updated_at desc
  limit 1
  for update;

  if v_wallet_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_wallet');
  end if;

  if v_co = 0 and v_ex = 0 then
    update public.user_wallets
       set balance_points = 0,
           updated_at = now()
     where id = v_wallet_id
       and coalesce(balance_points, 0) <> 0;
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_zero',
      'wallet_id', v_wallet_id
    );
  end if;

  v_key_co := 'subscription_cancel_forfeit:' || v_sub || ':consumption';
  v_key_ex := 'subscription_cancel_forfeit:' || v_sub || ':exchange';
  v_meta := jsonb_build_object(
    'source', 'subscription_cancel_forfeit',
    'subscription_id', v_sub,
    'cancel_source', v_src
  );

  if v_co > 0 then
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
      'debit',
      'debit',
      v_co,
      'posted',
      v_key_co,
      v_meta || jsonb_build_object('forfeit_bucket', 'consumption'),
      'consumption'
    )
    on conflict (idempotency_key) do nothing;
  end if;

  if v_ex > 0 then
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
      'debit',
      'debit',
      v_ex,
      'posted',
      v_key_ex,
      v_meta || jsonb_build_object('forfeit_bucket', 'exchange'),
      'exchange'
    )
    on conflict (idempotency_key) do nothing;
  end if;

  update public.user_wallets
     set balance_consumption_points = 0,
         balance_exchange_points = 0,
         balance_points = 0,
         updated_at = now()
   where id = v_wallet_id;

  return jsonb_build_object(
    'ok', true,
    'wallet_id', v_wallet_id,
    'forfeited_consumption_points', v_co,
    'forfeited_exchange_points', v_ex
  );
end;
$$;

revoke all on function public.wallet_forfeit_on_immediate_subscription_cancel(uuid, text, text) from public;
grant execute on function public.wallet_forfeit_on_immediate_subscription_cancel(uuid, text, text) to service_role;
