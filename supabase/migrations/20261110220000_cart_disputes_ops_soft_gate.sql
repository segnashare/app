-- Suspension soft ops (modale membre) — distincte du blocage auth et de la facture impayée.

alter table public.cart_disputes
  add column if not exists ops_soft_gate jsonb not null default '{}'::jsonb;

comment on column public.cart_disputes.ops_soft_gate is
  'Suspension soft BO : { active, dismissible, activatedAt, activatedBy, note }. Modale membre, pas de cut-off auth.';
