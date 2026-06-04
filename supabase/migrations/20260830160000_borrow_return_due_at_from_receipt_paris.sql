-- Échéance retour : X jours calendaires après validation réception, fin de journée 23:59:59 Europe/Paris
-- (indépendant du fuseau serveur Supabase).

comment on column public.carts.checkout_borrow_duration_days is
  'Durée d''emprunt choisie au checkout (jours calendaires à partir de la validation réception membre).';

comment on column public.carts.borrow_return_due_at is
  'Échéance retour : figée à la validation réception (23:59 Europe/Paris + durée checkout ou membership), puis prolongations.';

create or replace function public.borrow_return_due_end_of_paris_day(p_paris_date date)
returns timestamptz
language sql
stable
as $$
  select ((p_paris_date::timestamp + time '23:59:59') at time zone 'Europe/Paris');
$$;

comment on function public.borrow_return_due_end_of_paris_day(date) is
  'Instant UTC correspondant à 23:59:59 Europe/Paris pour une date calendaire Paris.';

create or replace function public.add_borrow_calendar_days_paris(
  p_base_due timestamptz,
  p_extra_days integer
)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_paris_date date;
begin
  if p_base_due is null then
    return null;
  end if;
  if coalesce(p_extra_days, 0) <= 0 then
    return p_base_due;
  end if;

  v_paris_date := (p_base_due at time zone 'Europe/Paris')::date + p_extra_days;
  return public.borrow_return_due_end_of_paris_day(v_paris_date);
end;
$$;

comment on function public.add_borrow_calendar_days_paris(timestamptz, integer) is
  'Ajoute N jours calendaires Paris à une échéance et normalise à 23:59:59 Paris.';

create or replace function public.compute_borrow_return_due_at_from_receipt(
  p_receipt_confirmed_at timestamptz,
  p_user_id uuid,
  p_checkout_borrow_duration_days integer default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_paris_receipt date;
  v_due_date date;
  v_plan text;
  v_status text;
begin
  if p_receipt_confirmed_at is null then
    return null;
  end if;

  v_paris_receipt := (p_receipt_confirmed_at at time zone 'Europe/Paris')::date;

  if p_checkout_borrow_duration_days is not null and p_checkout_borrow_duration_days >= 1 then
    v_due_date := v_paris_receipt + p_checkout_borrow_duration_days;
    return public.borrow_return_due_end_of_paris_day(v_due_date);
  end if;

  select us.plan_code, us.status
    into v_plan, v_status
  from public.user_subscriptions us
  where us.user_id = p_user_id
    and us.provider = 'stripe'
  order by us.updated_at desc nulls last
  limit 1;

  if coalesce(v_status, '') in ('active', 'trialing') and coalesce(v_plan, '') = 'segna_x' then
    v_due_date := v_paris_receipt + 30;
  elsif coalesce(v_status, '') in ('active', 'trialing') and coalesce(v_plan, '') = 'segna_plus' then
    v_due_date := (v_paris_receipt + interval '1 month')::date;
  else
    v_due_date := v_paris_receipt + 10;
  end if;

  return public.borrow_return_due_end_of_paris_day(v_due_date);
end;
$$;

comment on function public.compute_borrow_return_due_at_from_receipt(timestamptz, uuid, integer) is
  'Échéance initiale : jour réception Paris + durée checkout (ou membership legacy), à 23:59:59 Europe/Paris.';

create or replace function public.trg_carts_set_borrow_return_due_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.member_receipt_confirmed_at is not null
     and OLD.member_receipt_confirmed_at is null then
    NEW.borrow_return_due_at := public.compute_borrow_return_due_at_from_receipt(
      NEW.member_receipt_confirmed_at,
      NEW.user_id,
      NEW.checkout_borrow_duration_days
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_carts_set_borrow_return_due_on_receipt on public.carts;
create trigger trg_carts_set_borrow_return_due_on_receipt
  before update on public.carts
  for each row
  execute function public.trg_carts_set_borrow_return_due_on_receipt();

-- Ne plus initialiser l'échéance à la livraison (uniquement à la validation réception).
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
  v_context text;
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
  'Statut colis ; borrow_return_due_at à la validation réception (trigger carts) ; member_intake dropped_out → intake shipping.';

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
  v_base_due timestamptz;
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

  select coalesce(
    c.borrow_return_due_at,
    public.compute_borrow_return_due_at_from_receipt(
      c.member_receipt_confirmed_at,
      c.user_id,
      c.checkout_borrow_duration_days
    )
  )
    into v_base_due
  from public.carts c
  where c.id = p_cart_id;

  if v_base_due is null then
    return jsonb_build_object('applied', false, 'reason', 'no_borrow_return_due_at');
  end if;

  update public.carts c
  set
    borrow_return_due_at = public.add_borrow_calendar_days_paris(v_base_due, p_extension_days),
    updated_at = timezone('utc', now())
  where c.id = p_cart_id;

  return jsonb_build_object('applied', true);
end;
$$;

-- Paniers livrés sans réception validée : effacer une échéance calculée à tort à la livraison.
update public.carts c
set
  borrow_return_due_at = null,
  updated_at = timezone('utc', now())
where c.member_receipt_confirmed_at is null
  and c.borrow_return_due_at is not null
  and c.deleted_at is null;

-- Recalcul pour les réceptions déjà validées (+ prolongations en jours calendaires Paris).
update public.carts c
set
  borrow_return_due_at = public.add_borrow_calendar_days_paris(
    public.compute_borrow_return_due_at_from_receipt(
      c.member_receipt_confirmed_at,
      c.user_id,
      c.checkout_borrow_duration_days
    ),
    coalesce(
      (
        select sum(e.extension_days)::integer
        from public.cart_borrow_extensions e
        where e.cart_id = c.id
      ),
      0
    )
  ),
  updated_at = timezone('utc', now())
where c.member_receipt_confirmed_at is not null
  and c.deleted_at is null;

grant execute on function public.borrow_return_due_end_of_paris_day(date) to service_role;
grant execute on function public.add_borrow_calendar_days_paris(timestamptz, integer) to service_role;
grant execute on function public.compute_borrow_return_due_at_from_receipt(timestamptz, uuid, integer) to service_role;
