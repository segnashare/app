-- Base pénalités retard : 1 crédit Segna = 1 € (100 cts), pas ×5 cts (wallet/prolongation).

create or replace function public.resolve_cart_borrow_value_cents(p_cart_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(
      (
        select greatest(0, sum(coalesce(i.price_points, 0))::bigint * 100)
        from public.cart_items ci
        join public.items i on i.id = ci.item_id
        where ci.cart_id = p_cart_id
          and ci.deleted_at is null
          and i.deleted_at is null
      ),
      0
    ),
    (
      select greatest(0, inv.amount_total_cents::bigint)
      from public.cart_order_stripe_invoices inv
      where inv.cart_id = p_cart_id
      limit 1
    ),
    0::bigint
  );
$$;

comment on function public.resolve_cart_borrow_value_cents(uuid) is
  'Base pénalités retard : somme price_points×100 cts (1 crédit=1€), sinon montant TTC facture panier.';

-- Recalcul des retards actifs et jours non encore prélevés.
update public.cart_borrow_overdue o
set
  cart_value_cents = public.resolve_cart_borrow_value_cents(o.cart_id),
  updated_at = now()
where o.status = 'active';

update public.cart_borrow_overdue_days d
set
  penalty_cents = round(o.cart_value_cents * d.rate_bps / 10000.0)::bigint,
  penalty_credits = public.cents_to_borrow_penalty_credits(
    round(o.cart_value_cents * d.rate_bps / 10000.0)::bigint
  )
from public.cart_borrow_overdue o
where d.overdue_id = o.id
  and d.charge_status in ('pending', 'failed')
  and d.stripe_payment_intent_id is null;
