-- Canal / vitesse checkout (source metadata Stripe) pour affichage commande membre même si l’attach Uber DB est en retard ou absent.
alter table public.cart_order_stripe_invoices
  add column if not exists checkout_delivery_channel text null;

alter table public.cart_order_stripe_invoices
  add column if not exists checkout_home_speed text null;

comment on column public.cart_order_stripe_invoices.checkout_delivery_channel is
  'Valeur Stripe metadata delivery_channel au moment du paiement (relay | home).';

comment on column public.cart_order_stripe_invoices.checkout_home_speed is
  'Valeur Stripe metadata home_speed (standard | uber_direct | …).';

create or replace function public.get_member_cart_order_stripe_invoice(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  r public.cart_order_stripe_invoices%rowtype;
begin
  if v_uid is null then
    return null;
  end if;

  select c.user_id
    into v_owner
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null;

  if v_owner is null or v_owner <> v_uid then
    return null;
  end if;

  select i.*
    into r
  from public.cart_order_stripe_invoices i
  where i.cart_id = p_cart_id
    and i.user_id = v_uid;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'checkout_session_id', r.checkout_session_id,
    'payment_intent_id', r.payment_intent_id,
    'amount_total_cents', r.amount_total_cents,
    'credits_line_cents', r.credits_line_cents,
    'service_ttc_cents', r.service_ttc_cents,
    'shipping_ttc_cents', r.shipping_ttc_cents,
    'fees_ttc_cents', r.fees_ttc_cents,
    'fees_vat_cents', r.fees_vat_cents,
    'currency', r.currency,
    'created_at', r.created_at,
    'checkout_delivery_channel', r.checkout_delivery_channel,
    'checkout_home_speed', r.checkout_home_speed
  );
end;
$fn$;

-- Résumé expédition aller (Échange) : inclure canal / vitesse checkout depuis la facture Stripe.
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
    'checkout_home_speed', ci.checkout_home_speed
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
