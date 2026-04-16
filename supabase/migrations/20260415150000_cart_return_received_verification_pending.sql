-- 1) Colonne preuve défaut retour (si migration 20260410143000 non appliquée sur l’instance).
alter table public.cart_items
  add column if not exists return_verification jsonb;

comment on column public.cart_items.return_verification is
  'JSON contrôle retour BO : defect_kind, note, photo_paths (storage), etc.';

-- 2) Dès que l’expédition retour est « reçue » côté flux membre (returned / en_verification),
--    les lignes encore en reserved passent en verification_pending (file BO contrôle).
create or replace function public.trg_shipments_cart_return_received_set_lines_pending()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.context is distinct from 'cart_return'::public.shipment_context then
    return new;
  end if;
  if new.deleted_at is not null then
    return new;
  end if;
  if new.cart_id is null then
    return new;
  end if;

  if lower(new.status::text) not in ('returned', 'en_verification') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(coalesce(old.status::text, '')) in ('returned', 'en_verification') then
      return new;
    end if;
  end if;

  update public.cart_items ci
  set
    status = 'verification_pending'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = new.cart_id
    and ci.deleted_at is null
    and ci.status = 'reserved'::public.cart_item_status;

  return new;
end;
$$;

drop trigger if exists trg_shipments_cart_return_received_set_lines_pending on public.shipments;
create trigger trg_shipments_cart_return_received_set_lines_pending
after insert or update of status on public.shipments
for each row
execute function public.trg_shipments_cart_return_received_set_lines_pending();

-- 3) Rattrapage : envois retour déjà « reçus » mais lignes encore reserved.
update public.cart_items ci
set
  status = 'verification_pending'::public.cart_item_status,
  updated_at = now()
from public.shipments s
where s.cart_id = ci.cart_id
  and s.context = 'cart_return'::public.shipment_context
  and s.deleted_at is null
  and lower(s.status::text) in ('returned', 'en_verification')
  and ci.deleted_at is null
  and ci.status = 'reserved'::public.cart_item_status;
