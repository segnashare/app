-- Lors du sync abonnement, créditer `balance_consumption_points` (pastille / panier) selon
-- `billing_plan_entitlement_limits.max_lending_points_limit` pour Segna+ / SegnaX.
-- Idempotence : une transaction `wallet_transactions` par (user, mois calendaire UTC, plan).

drop function if exists public.billing_upsert_monthly_entitlement(uuid, text, date);

create or replace function public.billing_upsert_monthly_entitlement(
  p_user_id uuid,
  p_plan_code text,
  p_period_month date default date_trunc('month', timezone('utc', now()))::date
)
returns public.user_monthly_entitlements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_monthly_entitlements;
  v_grant bigint;
  v_idem text;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_co bigint;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_plan_code is null or p_plan_code not in ('guest', 'segna_plus', 'segna_x') then
    raise exception 'Invalid plan code: %', p_plan_code;
  end if;

  insert into public.user_monthly_entitlements(
    user_id,
    period_month,
    plan_code
  )
  values (
    p_user_id,
    p_period_month,
    p_plan_code
  )
  on conflict (user_id, period_month) do update
  set
    plan_code = excluded.plan_code,
    updated_at = now()
  returning * into v_row;

  if p_plan_code in ('segna_plus', 'segna_x') then
    select l.max_lending_points_limit
      into v_grant
    from public.billing_plan_limits(p_plan_code) l;

    v_grant := coalesce(v_grant, 0);

    if v_grant > 0 then
      v_idem :=
        'subscription_monthly_consumption_grant:'
        || p_user_id::text
        || ':'
        || to_char(p_period_month, 'YYYY-MM-DD')
        || ':'
        || p_plan_code;

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
        v_grant,
        'posted',
        v_idem,
        jsonb_build_object(
          'source', 'subscription_monthly_consumption',
          'plan_code', p_plan_code,
          'period_month', p_period_month
        ),
        'consumption'
      )
      on conflict (idempotency_key) do nothing
      returning id into v_tx_id;

      if v_tx_id is not null then
        update public.user_wallets uw
           set balance_consumption_points = coalesce(uw.balance_consumption_points, 0) + v_grant,
               updated_at = now()
         where uw.id = (
            select w.id
            from public.user_wallets w
            where w.user_id = p_user_id
              and w.deleted_at is null
            order by w.updated_at desc
            limit 1
         )
        returning uw.id, uw.balance_consumption_points into v_wallet_id, v_new_co;

        if v_wallet_id is null then
          insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
          values (p_user_id, v_grant, 0);
        end if;
      end if;
    end if;
  end if;

  return v_row;
end;
$$;

comment on function public.billing_upsert_monthly_entitlement(uuid, text, date) is
  'Upsert ligne mensuelle + crédit wallet consommation (Segna+ / SegnaX) idempotent par mois/plan.';

grant execute on function public.billing_upsert_monthly_entitlement(uuid, text, date) to authenticated;
