-- Renomme processing_fee_cents → unpaid_penalty_cents (frais de retard non réglés sur facture non-restitution).

alter table public.cart_borrow_overdue
  rename column processing_fee_cents to unpaid_penalty_cents;

comment on column public.cart_borrow_overdue.unpaid_penalty_cents is
  'Montant des frais de retard non réglés inclus sur la dernière facture non-restitution (cts).';

alter table public.cart_borrow_non_restitution_charges
  rename column processing_fee_cents to unpaid_penalty_cents;

comment on column public.cart_borrow_non_restitution_charges.unpaid_penalty_cents is
  'Frais de retard non réglés facturés avec l''indemnité non-restitution (cts).';

comment on column public.cart_borrow_non_restitution_charges.stripe_invoice_id is
  'Facture Stripe Billing (Smart Retries) — indemnité non-restitution + frais de retard non réglés.';

comment on function public.borrow_non_return_processing_fee_cents(bigint) is
  'Déprécié : forfait traitement remplacé par frais de retard non réglés sur facture non-restitution.';
