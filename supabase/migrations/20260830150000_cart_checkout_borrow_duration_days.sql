-- Durée d'emprunt choisie au checkout (7 / 14 / 30 j) — tarif complément crédits + échéance retour.

alter table public.carts
  add column if not exists checkout_borrow_duration_days integer;

alter table public.carts
  drop constraint if exists carts_checkout_borrow_duration_days_check;

alter table public.carts
  add constraint carts_checkout_borrow_duration_days_check
  check (
    checkout_borrow_duration_days is null
    or (checkout_borrow_duration_days >= 1 and checkout_borrow_duration_days <= 90)
  );

comment on column public.carts.checkout_borrow_duration_days is
  'Durée d''emprunt choisie au checkout panier (jours calendaires à partir de la livraison aller).';

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
  v_checkout_borrow_days integer;
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

  select s.context::text into v_context
  from public.shipments s
  where s.id = p_shipment_id;

  if p_to_status = 'delivered'::public.shipment_status then
    select s.cart_id, s.context::text, s.delivered_at
      into v_cart_id, v_context, v_delivered_at
    from public.shipments s
    where s.id = p_shipment_id;

    if v_cart_id is not null and v_context = 'cart_outbound' and v_delivered_at is not null then
      select c.user_id, c.checkout_borrow_duration_days
        into v_user_id, v_checkout_borrow_days
      from public.carts c
      where c.id = v_cart_id
        and c.deleted_at is null;

      if v_user_id is not null then
        update public.carts c
        set
          borrow_return_due_at = case
            when v_checkout_borrow_days is not null and v_checkout_borrow_days >= 1 then
              v_delivered_at + (v_checkout_borrow_days || ' days')::interval
            else
              public.compute_borrow_return_due_at_from_delivery(v_delivered_at, v_user_id)
          end,
          updated_at = v_ts
        where c.id = v_cart_id
          and c.borrow_return_due_at is null;
      end if;
    end if;
  end if;

  if p_to_status = 'dropped_out'::public.shipment_status and v_context = 'member_intake' then
    perform public.promote_member_intake_items_to_shipping(p_shipment_id);
  end if;

  if p_to_status in (
    'delivered'::public.shipment_status,
    'returned'::public.shipment_status,
    'en_verification'::public.shipment_status
  ) then
    if v_context in ('member_intake', 'cart_return') then
      perform public.promote_intake_items_to_in_verification_on_shipment_delivered(p_shipment_id);
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
  'Statut colis ; borrow_return_due_at utilise checkout_borrow_duration_days si défini ; member_intake dropped_out → intake shipping.';
