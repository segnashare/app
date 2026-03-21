-- Add status to item_condition_history for draft vs confirmed entries
alter table public.item_condition_history
  add column if not exists status text not null default 'draft'
  check (status in ('draft', 'confirmed'));

comment on column public.item_condition_history.status is 'draft=état annoncé en cours de saisie, confirmed=validé';
