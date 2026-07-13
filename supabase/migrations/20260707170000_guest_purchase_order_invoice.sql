-- Achat Guest : mode checkout persisté + facture Stripe post-paiement (PDF / e-mail).

alter table public.carts
  add column if not exists checkout_purchase_mode boolean not null default false;

comment on column public.carts.checkout_purchase_mode is
  'true si la commande a été passée en mode achat (Guest) au checkout.';

alter table public.cart_order_stripe_invoices
  add column if not exists guest_purchase_stripe_invoice_id text null;

alter table public.cart_order_stripe_invoices
  add column if not exists guest_purchase_stripe_invoice_hosted_url text null;

comment on column public.cart_order_stripe_invoices.guest_purchase_stripe_invoice_id is
  'Facture Stripe émise après paiement Checkout (achat Guest, paid_out_of_band).';

comment on column public.cart_order_stripe_invoices.guest_purchase_stripe_invoice_hosted_url is
  'URL hébergée Stripe pour consulter / télécharger la facture achat Guest.';

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
    'checkout_home_speed', r.checkout_home_speed,
    'guest_purchase_stripe_invoice_id', r.guest_purchase_stripe_invoice_id,
    'guest_purchase_stripe_invoice_hosted_url', r.guest_purchase_stripe_invoice_hosted_url
  );
end;
$fn$;
