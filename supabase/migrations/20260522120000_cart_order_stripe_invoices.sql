-- Snapshot facture Stripe (€) pour les commandes panier — distinct du wallet (crédits Segna).

create table public.cart_order_stripe_invoices (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  checkout_session_id text not null,
  payment_intent_id text,
  amount_total_cents integer not null,
  credits_line_cents integer not null default 0,
  service_ttc_cents integer not null default 0,
  shipping_ttc_cents integer not null default 0,
  fees_ttc_cents integer,
  fees_vat_cents integer,
  currency text not null default 'eur',
  created_at timestamptz not null default now(),
  constraint cart_order_stripe_invoices_cart_id_key unique (cart_id),
  constraint cart_order_stripe_invoices_checkout_session_id_key unique (checkout_session_id)
);

create index cart_order_stripe_invoices_user_id_idx on public.cart_order_stripe_invoices (user_id);

comment on table public.cart_order_stripe_invoices is
  'Montants TTC encaissés sur Stripe pour une commande panier (metadata Checkout), pour affichage type facture côté membre.';

alter table public.cart_order_stripe_invoices enable row level security;

-- Aucune policy : lecture via RPC security definer ; écriture service_role uniquement.

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
    'created_at', r.created_at
  );
end;
$fn$;

comment on function public.get_member_cart_order_stripe_invoice(uuid) is
  'Membre : snapshot € Stripe pour un panier (si enregistré après paiement).';

revoke all on function public.get_member_cart_order_stripe_invoice(uuid) from public;
grant execute on function public.get_member_cart_order_stripe_invoice(uuid) to authenticated;
