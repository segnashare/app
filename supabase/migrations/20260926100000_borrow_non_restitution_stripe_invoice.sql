-- PR5 : facture Stripe indemnité non-restitution (valeur panier + frais traitement).

alter table public.cart_borrow_non_restitution_charges
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_invoice_hosted_url text;

create unique index if not exists cart_borrow_non_restitution_charges_overdue_uidx
  on public.cart_borrow_non_restitution_charges (overdue_id);

alter table public.cart_borrow_overdue
  add column if not exists non_restitution_invoice_id text;

comment on column public.cart_borrow_non_restitution_charges.stripe_invoice_id is
  'Facture Stripe Billing (Smart Retries) — indemnité non-restitution + frais traitement.';

comment on column public.cart_borrow_overdue.non_restitution_invoice_id is
  'Dernière facture Stripe indemnité non-restitution (miroir charges.stripe_invoice_id).';
