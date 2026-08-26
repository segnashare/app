-- Segna X : réduction achat catalogue 30 % → 20 % (aligné app / site).
comment on column public.billing_plan_entitlement_limits.purchase_discount_percent is
  'Réduction % sur le prix d’achat catalogue (0–100). Ex. SegnaX 20 = -20 %.';

update public.billing_plan_entitlement_limits
set purchase_discount_percent = 20,
    updated_at = now()
where plan_code = 'segna_x'
  and purchase_discount_percent = 30;
