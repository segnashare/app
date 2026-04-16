-- Statut panier « litige retour / contrôle » après constat à la réception.
do $body$
begin
  alter type public.cart_status add value 'disputed';
exception
  when duplicate_object then null;
end $body$;

comment on type public.cart_status is
  'Panier : active, checkout_pending, confirmed, archived, canceled, disputed (litige ouvert — ex. retour).';

-- Preuve défaut à la réception (contrôle retour BO) — conservée tant que la ligne est `rejected`.
alter table public.cart_items
  add column if not exists return_verification jsonb;

comment on column public.cart_items.return_verification is
  'JSON contrôle retour BO : defect_kind, note, photo_paths (storage), etc.';
