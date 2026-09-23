-- SegnaX live : 40 € TTC / mois.
-- Ancien tarif 49,99 € conservé (is_active = false) pour mapper les abonnés déjà dessus.

update public.billing_plan_prices
set
  is_active = false,
  updated_at = now()
where provider = 'stripe'
  and plan_code = 'segna_x'
  and stripe_price_id is distinct from 'price_1UI5M9KHxrskIC2R3Ey5dmwx'
  and is_active is distinct from false;

insert into public.billing_plan_prices (
  provider,
  plan_code,
  stripe_product_id,
  stripe_price_id,
  monthly_included_orders,
  monthly_consumption_points_grant,
  is_active,
  metadata
)
values (
  'stripe',
  'segna_x',
  'prod_UXALPoOomXWcde',
  'price_1UI5M9KHxrskIC2R3Ey5dmwx',
  1,
  400,
  true,
  jsonb_build_object(
    'amount_eur_ttc', 40,
    'tax_behavior', 'inclusive',
    'lookup_key', 'segna_x_monthly_eur_40_ttc',
    'replaces_stripe_price_id', 'price_1TY60lKHxrskIC2RPRpgBpuJ'
  )
)
on conflict (stripe_price_id) do update
set
  provider = excluded.provider,
  plan_code = excluded.plan_code,
  stripe_product_id = excluded.stripe_product_id,
  monthly_included_orders = excluded.monthly_included_orders,
  monthly_consumption_points_grant = excluded.monthly_consumption_points_grant,
  is_active = true,
  metadata = public.billing_plan_prices.metadata || excluded.metadata,
  updated_at = now();
