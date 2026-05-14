-- Alignement plan Guest avec le comparatif package (échanges inclus / crédits mensuels).
-- Source affichage : `billing_plan_entitlement_limits` (voir fetch-plan-entitlement-comparison-limits).

update public.billing_plan_entitlement_limits
set
  included_orders_limit = 1,
  monthly_consumption_points_grant = 0,
  updated_at = now()
where plan_code = 'guest';
