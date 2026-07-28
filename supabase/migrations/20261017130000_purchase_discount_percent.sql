-- % de réduction à l’achat des pièces (Management board), par plan.
alter table public.billing_plan_entitlement_limits
  add column if not exists purchase_discount_percent integer not null default 0
  check (purchase_discount_percent >= 0 and purchase_discount_percent <= 100);

comment on column public.billing_plan_entitlement_limits.purchase_discount_percent is
  'Réduction % sur le prix d’achat catalogue (0–100). Ex. SegnaX 30 = -30 %.';

update public.billing_plan_entitlement_limits
set purchase_discount_percent = 30
where plan_code = 'segna_x'
  and purchase_discount_percent = 0;
