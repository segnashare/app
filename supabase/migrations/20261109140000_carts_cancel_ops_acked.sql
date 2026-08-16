-- Accusé de réception BO : annulation panier vue / enregistrée par l’ops.
alter table public.carts
  add column if not exists cancel_ops_acked_at timestamptz null;

alter table public.carts
  add column if not exists cancel_ops_acked_by uuid null references auth.users (id) on delete set null;

comment on column public.carts.cancel_ops_acked_at is
  'Back-office : instant où l’ops a pris en compte l’annulation (file « Paniers annulés »).';

comment on column public.carts.cancel_ops_acked_by is
  'Back-office : admin ayant marqué l’annulation comme prise en compte.';

create index if not exists carts_cancel_ops_pending_idx
  on public.carts (updated_at desc)
  where status = 'canceled'::public.cart_status
    and deleted_at is null
    and cancel_ops_acked_at is null;

-- Pastille « Paniers validés » : inclut les annulations à prendre en compte.
create or replace function public.backoffice_commandes_nav_tab_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_paniers_valides bigint;
  v_canceled_pending_ack bigint;
  v_open_disputes bigint;
  v_retours_urgents bigint;
  v_mise_en_colis bigint;
  v_expeditions_post bigint;
  v_home_ready bigint;
  v_reprise_sim bigint;
  v_reprise_verify bigint;
  v_now timestamptz := now();
  v_day interval := interval '1 day';
begin
  select count(*)::bigint
  into v_paniers_valides
  from public.carts c
  where c.deleted_at is null
    and c.status = 'confirmed'
    and not exists (
      select 1
      from public.shipments s
      where s.cart_id = c.id
        and s.context = 'cart_outbound'
        and s.deleted_at is null
    );

  select count(*)::bigint
  into v_canceled_pending_ack
  from public.carts c
  where c.deleted_at is null
    and c.status = 'canceled'
    and c.cancel_ops_acked_at is null;

  select count(*)::bigint
  into v_open_disputes
  from public.cart_disputes d
  where d.deleted_at is null
    and d.status in ('open', 'in_review');

  select count(*)::bigint
  into v_retours_urgents
  from (
    select distinct on (s.cart_id)
      s.cart_id,
      coalesce(
        nullif(trim(c.borrow_return_due_at::text), '')::timestamptz,
        coalesce(s.delivered_at, s.updated_at) + interval '14 days'
      ) as due_at
    from public.shipments s
    inner join public.carts c
      on c.id = s.cart_id
     and c.deleted_at is null
     and c.status = 'confirmed'
    where s.deleted_at is null
      and s.context = 'cart_outbound'
      and s.status = 'delivered'
    order by s.cart_id, s.updated_at desc
  ) x
  where x.due_at < v_now + v_day;

  select count(*)::bigint
  into v_mise_en_colis
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_outbound'
    and s.status = 'pending';

  select count(*)::bigint
  into v_expeditions_post
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_outbound'
    and s.status in ('ready', 'dropped_in', 'in_transit_in');

  select count(*)::bigint
  into v_home_ready
  from public.shipments s
  inner join public.cart_order_stripe_invoices inv
    on inv.cart_id = s.cart_id
  where s.deleted_at is null
    and s.context = 'cart_outbound'
    and s.status = 'ready'
    and lower(coalesce(inv.checkout_delivery_channel, '')) = 'home'
    and lower(coalesce(inv.checkout_home_speed, '')) = 'direct';

  select count(*)::bigint
  into v_reprise_sim
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_return'
    and s.status in ('ready', 'dropped_out', 'in_transit_out', 'dropped_in', 'in_transit_in');

  select count(*)::bigint
  into v_reprise_verify
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_return'
    and s.status = 'returned';

  return jsonb_build_object(
    'paniersValides', v_paniers_valides + v_canceled_pending_ack,
    'litigesRetards', v_open_disputes + v_retours_urgents,
    'miseEnColis', v_mise_en_colis,
    'expeditionsPostPreparation', v_mise_en_colis + v_expeditions_post + v_home_ready,
    'repriseControle', v_reprise_sim + v_reprise_verify
  );
end;
$$;

grant execute on function public.backoffice_commandes_nav_tab_counts() to service_role;
