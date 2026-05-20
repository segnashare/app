-- Date limite de retour figée sur le panier : initialisée à la livraison aller, prolongée par +N jours à chaque extension payée.

alter table public.carts
  add column if not exists borrow_return_due_at timestamptz;

comment on column public.carts.borrow_return_due_at is
  'Échéance de retour du panier emprunté : fixée au premier passage aller en delivered, puis +extension_days à chaque prolongation.';

create or replace function public.compute_borrow_return_due_at_from_delivery(
  p_delivered_at timestamptz,
  p_user_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_status text;
begin
  if p_delivered_at is null then
    return null;
  end if;

  select us.plan_code, us.status
    into v_plan, v_status
  from public.user_subscriptions us
  where us.user_id = p_user_id
    and us.provider = 'stripe'
  order by us.updated_at desc nulls last
  limit 1;

  if coalesce(v_status, '') in ('active', 'trialing') and coalesce(v_plan, '') = 'segna_x' then
    return p_delivered_at + interval '30 days';
  end if;

  if coalesce(v_status, '') in ('active', 'trialing') and coalesce(v_plan, '') = 'segna_plus' then
    return p_delivered_at + interval '1 month';
  end if;

  return p_delivered_at + interval '10 days';
end;
$$;

comment on function public.compute_borrow_return_due_at_from_delivery(timestamptz, uuid) is
  'Échéance initiale (Guest 10 j, Segna X 30 j, Segna + 1 mois calendaire) — aligné sur segna-app borrow-period.ts.';

-- Backfill : livraison aller + extensions déjà payées.
with delivered as (
  select
    c.id as cart_id,
    c.user_id,
    s.delivered_at,
    coalesce(s.delivered_at, s.updated_at) as anchor_at
  from public.carts c
  join public.shipments s
    on s.cart_id = c.id
   and s.context = 'cart_outbound'
   and s.deleted_at is null
   and s.status = 'delivered'::public.shipment_status
  where c.deleted_at is null
    and c.borrow_return_due_at is null
),
base as (
  select
    d.cart_id,
    public.compute_borrow_return_due_at_from_delivery(d.anchor_at, d.user_id) as base_due
  from delivered d
  where d.anchor_at is not null
),
ext as (
  select e.cart_id, coalesce(sum(e.extension_days), 0)::int as extra_days
  from public.cart_borrow_extensions e
  group by e.cart_id
)
update public.carts c
set borrow_return_due_at = b.base_due + (coalesce(x.extra_days, 0) || ' days')::interval
from base b
left join ext x on x.cart_id = b.cart_id
where c.id = b.cart_id
  and b.base_due is not null;

create or replace function public.apply_cart_borrow_extension(
  p_user_id uuid,
  p_cart_id uuid,
  p_extension_days integer,
  p_credits_charged integer,
  p_amount_cents integer,
  p_cart_item_ids uuid[],
  p_checkout_session_id text,
  p_payment_intent_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart_user uuid;
begin
  if p_checkout_session_id is null or trim(p_checkout_session_id) = '' then
    return jsonb_build_object('applied', false, 'reason', 'missing_session');
  end if;

  if exists (
    select 1 from public.cart_borrow_extensions e
    where e.stripe_checkout_session_id = p_checkout_session_id
  ) then
    return jsonb_build_object('applied', true, 'reason', 'already_applied');
  end if;

  select c.user_id into v_cart_user from public.carts c where c.id = p_cart_id;
  if v_cart_user is null then
    return jsonb_build_object('applied', false, 'reason', 'cart_not_found');
  end if;
  if v_cart_user <> p_user_id then
    return jsonb_build_object('applied', false, 'reason', 'forbidden');
  end if;

  if p_extension_days < 1 or p_extension_days > 60 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_days');
  end if;
  if p_credits_charged is null or p_credits_charged <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_credits');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_amount');
  end if;

  insert into public.cart_borrow_extensions (
    cart_id,
    user_id,
    extension_days,
    credits_charged,
    amount_cents,
    cart_item_ids,
    stripe_checkout_session_id,
    stripe_payment_intent_id
  ) values (
    p_cart_id,
    p_user_id,
    p_extension_days,
    p_credits_charged,
    p_amount_cents,
    coalesce(p_cart_item_ids, '{}'),
    p_checkout_session_id,
    nullif(trim(p_payment_intent_id), '')
  );

  update public.carts c
  set
    borrow_return_due_at = (
      coalesce(
        c.borrow_return_due_at,
        (
          select public.compute_borrow_return_due_at_from_delivery(
            coalesce(s.delivered_at, s.updated_at),
            c.user_id
          )
          from public.shipments s
          where s.cart_id = c.id
            and s.context = 'cart_outbound'
            and s.deleted_at is null
            and s.status = 'delivered'::public.shipment_status
          order by s.created_at desc
          limit 1
        )
      ) + (p_extension_days || ' days')::interval
    ),
    updated_at = timezone('utc', now())
  where c.id = p_cart_id
    and coalesce(
      c.borrow_return_due_at,
      (
        select public.compute_borrow_return_due_at_from_delivery(
          coalesce(s.delivered_at, s.updated_at),
          c.user_id
        )
        from public.shipments s
        where s.cart_id = c.id
          and s.context = 'cart_outbound'
          and s.deleted_at is null
          and s.status = 'delivered'::public.shipment_status
        order by s.created_at desc
        limit 1
      )
    ) is not null;

  return jsonb_build_object('applied', true);
end;
$$;

create or replace function public.transition_shipment_status(
  p_shipment_id uuid,
  p_if_current_status public.shipment_status,
  p_to_status public.shipment_status,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default 'system',
  p_context jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_set_ready_at boolean default true,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_ts timestamptz := coalesce(p_occurred_at, timezone('utc', now()));
  v_n int;
  v_hid uuid;
  v_cart_id uuid;
  v_user_id uuid;
  v_context text;
  v_delivered_at timestamptz;
begin
  if p_shipment_id is null then
    return jsonb_build_object('ok', false, 'error', 'p_shipment_id is required');
  end if;
  if p_to_status is null then
    return jsonb_build_object('ok', false, 'error', 'p_to_status is required');
  end if;
  if p_if_current_status is not distinct from p_to_status then
    return jsonb_build_object('ok', false, 'error', 'NO_STATUS_CHANGE');
  end if;

  update public.shipments s
  set
    status = p_to_status,
    updated_at = v_ts,
    tracking_number = case
      when p_tracking_number is not null and length(trim(p_tracking_number)) > 0 then trim(p_tracking_number)
      else s.tracking_number
    end,
    ready_at = case
      when coalesce(p_set_ready_at, true)
        and p_to_status = 'ready'::public.shipment_status
        and s.ready_at is null then v_ts
      else s.ready_at
    end,
    delivered_at = case
      when p_to_status = 'delivered'::public.shipment_status and s.delivered_at is null then v_ts
      else s.delivered_at
    end
  where s.id = p_shipment_id
    and s.deleted_at is null
    and s.status = p_if_current_status;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'STATUS_MISMATCH');
  end if;

  if p_to_status = 'delivered'::public.shipment_status then
    select s.cart_id, s.context::text, s.delivered_at
      into v_cart_id, v_context, v_delivered_at
    from public.shipments s
    where s.id = p_shipment_id;

    if v_cart_id is not null and v_context = 'cart_outbound' and v_delivered_at is not null then
      select c.user_id into v_user_id
      from public.carts c
      where c.id = v_cart_id
        and c.deleted_at is null;

      if v_user_id is not null then
        update public.carts c
        set
          borrow_return_due_at = public.compute_borrow_return_due_at_from_delivery(v_delivered_at, v_user_id),
          updated_at = v_ts
        where c.id = v_cart_id
          and c.borrow_return_due_at is null;
      end if;
    end if;
  end if;

  select public.append_shipment_status_history(
    p_shipment_id := p_shipment_id,
    p_to_status := p_to_status,
    p_from_status := p_if_current_status,
    p_actor_user_id := p_actor_user_id,
    p_reason := p_reason,
    p_source := p_source,
    p_context := p_context,
    p_occurred_at := v_ts
  )
  into v_hid;

  return jsonb_build_object('ok', true, 'history_id', v_hid);
end;
$fn$;

comment on function public.transition_shipment_status(
  uuid,
  public.shipment_status,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb,
  timestamptz,
  boolean,
  text
) is
  'Met à jour shipments.status, ready_at / delivered_at, initialise carts.borrow_return_due_at au premier delivered aller, puis historique.';
