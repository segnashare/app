-- À l’annulation panier : archiver (soft-delete) expéditions aller ET retour.

create or replace function public.archive_cart_shipments_on_cancel(p_cart_id uuid)
returns void
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if p_cart_id is null then
    return;
  end if;

  update public.shipments s
  set
    status = 'closed'::public.shipment_status,
    deleted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where s.cart_id = p_cart_id
    and s.context in (
      'cart_outbound'::public.shipment_context,
      'cart_return'::public.shipment_context
    )
    and s.deleted_at is null;
end;
$fn$;

comment on function public.archive_cart_shipments_on_cancel(uuid) is
  'Marque closed + deleted_at sur les shipments cart_outbound et cart_return d’un panier annulé.';

create or replace function public.trg_archive_cart_shipments_on_canceled()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if NEW.status = 'canceled'::public.cart_status
     and OLD.status is distinct from 'canceled'::public.cart_status then
    perform public.archive_cart_shipments_on_cancel(NEW.id);
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists archive_cart_shipments_on_canceled on public.carts;

create trigger archive_cart_shipments_on_canceled
  after update of status on public.carts
  for each row
  when (
    NEW.status = 'canceled'::public.cart_status
    and OLD.status is distinct from 'canceled'::public.cart_status
  )
  execute function public.trg_archive_cart_shipments_on_canceled();

-- Rattrapage : paniers déjà annulés dont les shipments sont encore actifs.
update public.shipments s
set
  status = 'closed'::public.shipment_status,
  deleted_at = timezone('utc', now()),
  updated_at = timezone('utc', now())
from public.carts c
where c.id = s.cart_id
  and c.status = 'canceled'::public.cart_status
  and c.deleted_at is null
  and s.context in (
    'cart_outbound'::public.shipment_context,
    'cart_return'::public.shipment_context
  )
  and s.deleted_at is null;
