-- Section « plafonds » archivable par plan ; libellés sémantiques crédits consommation.

alter table public.billing_plan_entitlement_limits
  add column if not exists is_active boolean not null default true;

comment on column public.billing_plan_entitlement_limits.is_active is
  'false = configuration archivée : billing_plan_limits() retombe sur les plafonds Guest pour ce plan_code.';

comment on column public.billing_plan_entitlement_limits.max_lending_points_limit is
  'Crédits de consommation offerts chaque mois par l''abonnement (effectif) : à partir du lancement de l''abonnement, la membre reçoit ce montant chaque période mensuelle. Colonne SQL inchangée (max_lending_points_limit) pour compatibilité.';

comment on column public.user_monthly_entitlements.lending_points_used is
  'Crédits de consommation déjà utilisés sur la période (compteur mensuel).';

drop function if exists public.billing_plan_limits(text);

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (
  included_orders_limit integer,
  max_lending_points_limit bigint,
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
      (select e.max_lending_points_limit
         from public.billing_plan_entitlement_limits e
        where e.plan_code = p_plan_code
          and coalesce(e.is_active, true)
        limit 1),
      (select g.max_lending_points_limit
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
  'Lit les plafonds du plan ; si la ligne est archivée (is_active = false), retombe sur les valeurs Guest.';
