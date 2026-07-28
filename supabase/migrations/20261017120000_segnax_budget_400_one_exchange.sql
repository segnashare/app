-- SegnaX : budget mensuel 400 € (points) + 1 échange inclus / mois.
-- Affichage app en euros (1 point = 1 €) ; le complément abonné est géré côté app (30 j @ 10 %).

update public.billing_plan_entitlement_limits
set
  monthly_consumption_points_grant = 400,
  included_orders_limit = 1,
  updated_at = now()
where plan_code = 'segna_x'
  and is_active is distinct from false;
