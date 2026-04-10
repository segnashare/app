-- Split `in_transit` → `in_transit_in` / `in_transit_out` + RPC suivi membre.
-- Les valeurs enum sont ajoutées dans 20260517115900_shipment_status_add_in_transit_in_out.sql (transaction précédente).

-- Aller panier → in_transit_in ; retour panier → in_transit_out ; autres contextes → in_transit_in.
update public.shipments s
set status = 'in_transit_in'::public.shipment_status
where s.status = 'in_transit'::public.shipment_status
  and s.context = 'cart_outbound'::public.shipment_context
  and s.deleted_at is null;

update public.shipments s
set status = 'in_transit_out'::public.shipment_status
where s.status = 'in_transit'::public.shipment_status
  and s.context = 'cart_return'::public.shipment_context
  and s.deleted_at is null;

update public.shipments s
set status = 'in_transit_in'::public.shipment_status
where s.status = 'in_transit'::public.shipment_status
  and s.context is distinct from 'cart_return'::public.shipment_context
  and s.deleted_at is null;

comment on type public.shipment_status is
  'in_transit_in = colis en route (aller vers le membre) ; in_transit_out = retour vers Segna.';

-- Résumé expédition aller pour le membre (panier confirmé), sans exposer toute la table.
create or replace function public.get_cart_outbound_shipment_summary(p_cart_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'shipment_id', s.id,
    'status', s.status::text,
    'tracking_number', s.tracking_number
  )
  from public.shipments s
  join public.carts c on c.id = s.cart_id
  where s.cart_id = p_cart_id
    and c.user_id = auth.uid()
    and c.deleted_at is null
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;
$fn$;

revoke all on function public.get_cart_outbound_shipment_summary(uuid) from public;
grant execute on function public.get_cart_outbound_shipment_summary(uuid) to authenticated;
