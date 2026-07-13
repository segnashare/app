-- Annulation panier achat Guest : preuve de paiement Stripe sans débit wallet.
-- Étend la preuve : checkout_purchase_mode, facture achat Guest, session Checkout en metadata.

create or replace function public.cart_order_cancel_stripe_payment_evidence(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.cart_payments cp where cp.cart_id = p_cart_id)
    or exists (select 1 from public.cart_order_stripe_invoices inv where inv.cart_id = p_cart_id)
    or exists (
      select 1
      from public.carts c
      where c.id = p_cart_id
        and c.checkout_purchase_mode is true
    )
    or exists (
      select 1
      from public.cart_order_stripe_invoices inv
      where inv.cart_id = p_cart_id
        and nullif(trim(inv.guest_purchase_stripe_invoice_id), '') is not null
    )
    or exists (
      select 1
      from public.wallet_transactions wt
      where wt.kind = 'debit'
        and wt.direction = 'debit'
        and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
        and (wt.metadata ->> 'cart_id')::uuid = p_cart_id
        and coalesce(wt.metadata ->> 'purchase_mode', '') = 'true'
    )
    or exists (
      select 1
      from public.wallet_transactions wt
      where wt.kind = 'debit'
        and wt.direction = 'debit'
        and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
        and (wt.metadata ->> 'cart_id')::uuid = p_cart_id
        and nullif(trim(wt.metadata ->> 'stripe_checkout_session_id'), '') is not null
        and trim(wt.metadata ->> 'stripe_checkout_session_id') <> 'wallet_only'
    );
$$;

comment on function public.cart_order_cancel_stripe_payment_evidence(uuid) is
  'Preuve paiement € panier pour annulation sans débit wallet (achat Guest, Checkout Stripe, cart_payments).';
