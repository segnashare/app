-- Prod drift : migration 20260410143000 enregistrée mais enum cart_status sans « disputed ».
-- Doit être commitée avant tout usage (escalade J+15 dans accrue_cart_borrow_overdue_day).

do $body$
begin
  alter type public.cart_status add value 'disputed';
exception
  when duplicate_object then null;
end $body$;

comment on type public.cart_status is
  'Panier : active, checkout_pending, confirmed, archived, canceled, disputed (litige ouvert — ex. retour).';
