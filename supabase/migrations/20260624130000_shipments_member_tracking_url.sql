-- Lien suivi membre distinct du numéro transporteur (ex. Uber `tracking_url` vs id course).
alter table public.shipments
  add column if not exists member_tracking_url text null;

comment on column public.shipments.member_tracking_url is
  'URL suivi côté membre (ex. Uber Direct). Optionnel ; tracking_number reste l’identifiant / numéro chez le transporteur.';

update public.shipment_providers
set is_active = true
where lower(code) = 'uber_direct';

-- Résumé expédition aller : inclure transporteur + URL suivi pour l’UI Échange / commande.
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
    'provider_code', sp.code
  )
  from public.shipments s
  join public.carts c on c.id = s.cart_id
  left join public.shipment_providers sp on sp.id = s.provider_id
  where s.cart_id = p_cart_id
    and c.user_id = auth.uid()
    and c.deleted_at is null
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;
$fn$;
