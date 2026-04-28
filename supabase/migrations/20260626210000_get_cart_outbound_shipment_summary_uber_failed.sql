-- Expose l’échec de création Uber (métadonnées `shipment_destinations` aller domicile) pour l’UI Échange.
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
    'tracking_number', s.tracking_number,
    'member_tracking_url', s.member_tracking_url,
    'provider_code', sp.code,
    'checkout_delivery_channel', ci.checkout_delivery_channel,
    'checkout_home_speed', ci.checkout_home_speed,
    'uber_outbound_failed', coalesce((
      select (sd.metadata->>'uber_outbound_failed') = 'true'
      from public.shipment_destinations sd
      where sd.shipment_id = s.id
        and sd.destination_type = 'home'::public.shipment_destination_type
      order by sd.id desc
      limit 1
    ), false)
  )
  from public.shipments s
  join public.carts c on c.id = s.cart_id
  left join public.shipment_providers sp on sp.id = s.provider_id
  left join public.cart_order_stripe_invoices ci
    on ci.cart_id = c.id
   and ci.user_id = c.user_id
  where s.cart_id = p_cart_id
    and c.user_id = auth.uid()
    and c.deleted_at is null
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;
$fn$;
