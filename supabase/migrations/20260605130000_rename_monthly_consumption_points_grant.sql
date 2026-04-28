-- Renommage colonnes : crédits consommation offerts chaque mois (plus de max_lending / monthly_max_lending).
-- Recréation des fonctions qui référencent ces colonnes ou le type de retour de billing_plan_limits().

drop function if exists public.get_current_membership_state();
drop function if exists public.billing_upsert_monthly_entitlement(uuid, text, date);
drop function if exists public.billing_plan_limits(text);

do $rename_entitlements$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'billing_plan_entitlement_limits'
      and c.column_name = 'max_lending_points_limit'
  ) then
    execute 'alter table public.billing_plan_entitlement_limits rename column max_lending_points_limit to monthly_consumption_points_grant';
  end if;
end
$rename_entitlements$;

do $rename_plan_prices$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'billing_plan_prices'
      and c.column_name = 'monthly_max_lending_points'
  ) then
    execute 'alter table public.billing_plan_prices rename column monthly_max_lending_points to monthly_consumption_points_grant';
  end if;
end
$rename_plan_prices$;

comment on column public.billing_plan_entitlement_limits.monthly_consumption_points_grant is
  'Crédits consommation offerts à chaque renouvellement mensuel (montant du grant). La dépense est limitée par le solde wallet.';

do $comment_plan_prices$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'billing_plan_prices'
      and c.column_name = 'monthly_consumption_points_grant'
  ) then
    execute $sql$
      comment on column public.billing_plan_prices.monthly_consumption_points_grant is
        'Documentation / marketing: credits consommation associes au prix Stripe (le grant effectif vient de billing_plan_entitlement_limits).';
    $sql$;
  end if;
end
$comment_plan_prices$;

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (
  included_orders_limit integer,
  monthly_consumption_points_grant bigint,
  included_lends_limit integer,
  free_items_per_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (select e.included_orders_limit
         from public.billing_plan_entitlement_limits e
        where e.plan_code = p_plan_code
          and coalesce(e.is_active, true)
        limit 1),
      (select g.included_orders_limit
         from public.billing_plan_entitlement_limits g
        where g.plan_code = 'guest'
          and coalesce(g.is_active, true)
        limit 1),
      0
    ),
    coalesce(
      (select e.monthly_consumption_points_grant
         from public.billing_plan_entitlement_limits e
        where e.plan_code = p_plan_code
          and coalesce(e.is_active, true)
        limit 1),
      (select g.monthly_consumption_points_grant
         from public.billing_plan_entitlement_limits g
        where g.plan_code = 'guest'
          and coalesce(g.is_active, true)
        limit 1),
      0::bigint
    ),
    coalesce(
      (select e.included_lends_limit
         from public.billing_plan_entitlement_limits e
        where e.plan_code = p_plan_code
          and coalesce(e.is_active, true)
        limit 1),
      (select g.included_lends_limit
         from public.billing_plan_entitlement_limits g
        where g.plan_code = 'guest'
          and coalesce(g.is_active, true)
        limit 1),
      0
    ),
    coalesce(
      (select e.free_items_per_order
         from public.billing_plan_entitlement_limits e
        where e.plan_code = p_plan_code
          and coalesce(e.is_active, true)
        limit 1),
      (select g.free_items_per_order
         from public.billing_plan_entitlement_limits g
        where g.plan_code = 'guest'
          and coalesce(g.is_active, true)
        limit 1),
      0
    );
$$;

grant execute on function public.billing_plan_limits(text) to authenticated;

comment on function public.billing_plan_limits(text) is
  'Paramètres effectifs du plan : livraisons incluses, crédits consommation offerts par mois, prêts inclus, articles gratuits par commande ; si is_active = false, retombe sur les valeurs Guest.';

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
    select l.monthly_consumption_points_grant
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
  'Upsert ligne mensuelle + crédit wallet consommation (Segna+ / SegnaX) idempotent par mois/plan ; montant = billing_plan_limits.monthly_consumption_points_grant.';

grant execute on function public.billing_upsert_monthly_entitlement(uuid, text, date) to authenticated;

create or replace function public.get_current_membership_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_plan_code text := 'guest';
  v_status text := 'inactive';
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_orders_used integer;
  v_lending_points_used bigint;
  v_orders_lim integer;
  v_points_lim bigint;
  v_lends_lim integer;
  v_free_items integer;
  v_wallet_co bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select s.plan_code, s.status, s.current_period_start, s.current_period_end
    into v_plan_code, v_status, v_period_start, v_period_end
  from public.user_subscriptions s
  where s.user_id = v_uid
    and s.provider = 'stripe'
  order by s.updated_at desc
  limit 1;

  select l.included_orders_limit, l.monthly_consumption_points_grant, l.included_lends_limit, l.free_items_per_order
    into v_orders_lim, v_points_lim, v_lends_lim, v_free_items
  from public.billing_plan_limits(coalesce(v_plan_code, 'guest')) l;

  select e.orders_used, e.lending_points_used
    into v_orders_used, v_lending_points_used
  from public.user_monthly_entitlements e
  where e.user_id = v_uid
    and e.period_month = date_trunc('month', timezone('utc', now()))::date
  limit 1;

  select coalesce(w.balance_consumption_points, 0)::bigint
    into v_wallet_co
  from public.user_wallets w
  where w.user_id = v_uid
    and w.deleted_at is null
  order by w.updated_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'guest'),
    'subscription_status', coalesce(v_status, 'inactive'),
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'included_orders_limit', coalesce(v_orders_lim, 0),
    'monthly_consumption_points_grant', coalesce(v_points_lim, 0),
    'balance_consumption_points_wallet', coalesce(v_wallet_co, 0),
    'included_lends_limit', coalesce(v_lends_lim, 0),
    'free_items_per_order', coalesce(v_free_items, 0),
    'orders_used', coalesce(v_orders_used, 0),
    'lending_points_used', coalesce(v_lending_points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_orders_lim, 0) - coalesce(v_orders_used, 0), 0),
    'remaining_lending_points_this_month', greatest(coalesce(v_wallet_co, 0), 0)
  );
end;
$$;

comment on function public.get_current_membership_state() is
  'État abonnement et compteurs mensuels. Points consommation utilisables = solde wallet ; monthly_consumption_points_grant = crédit mensuel configuré pour l''abonnement.';

grant execute on function public.get_current_membership_state() to authenticated;

comment on column public.billing_plan_entitlement_limits.is_active is
  'false = configuration archivée : billing_plan_limits() retombe sur les valeurs Guest pour ce plan_code.';
