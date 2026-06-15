-- member_intake dropped_out : promouvoir toutes les pièces du transfer (pas seulement si metadata sc_member_intake_shipment_id).

create or replace function public.promote_member_intake_items_to_shipping(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_ids uuid[];
  v_item_id uuid;
begin
  v_item_ids := public.member_intake_item_ids_from_shipment(p_shipment_id);

  foreach v_item_id in array v_item_ids
  loop
    update public.item_intake ii
    set fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage,
        updated_at = now()
    where ii.item_id = v_item_id
      and ii.deleted_at is null
      and ii.listing_stage = 'validated'::public.item_intake_listing_stage
      and ii.fulfillment_stage = 'ready'::public.item_intake_fulfillment_stage;
  end loop;
end;
$$;

comment on function public.promote_member_intake_items_to_shipping(uuid) is
  'member_intake → dropped_out : validated + ready → shipping pour toutes les pièces du transfer lié.';

-- Rattrapage : colis déjà déposés, pièces encore ready.
select public.promote_member_intake_items_to_shipping(s.id)
from public.shipments s
where s.deleted_at is null
  and s.context = 'member_intake'::public.shipment_context
  and lower(s.status::text) in ('dropped_out', 'dropped_in', 'in_transit_out');
