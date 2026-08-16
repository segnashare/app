-- Échéance à la réception : inclure les prolongations déjà payées (avant livraison).
-- Prolongation avant réception : enregistrer les jours sans exiger une échéance déjà figée.
-- Répare les paniers dont l’échéance est restée le jour de réception malgré une durée checkout.

create or replace function public.trg_carts_set_borrow_return_due_on_receipt()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_base timestamptz;
  v_ext integer;
begin
  if NEW.member_receipt_confirmed_at is not null
     and OLD.member_receipt_confirmed_at is null then
    v_base := public.compute_borrow_return_due_at_from_receipt(
      NEW.member_receipt_confirmed_at,
      NEW.user_id,
      NEW.checkout_borrow_duration_days
    );
    select coalesce(sum(e.extension_days), 0)::integer
      into v_ext
    from public.cart_borrow_extensions e
    where e.cart_id = NEW.id;
    NEW.borrow_return_due_at := public.add_borrow_calendar_days_paris(v_base, v_ext);
  end if;
  return NEW;
end;
$function$;

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
set search_path to public
as $function$
declare
  v_cart_user uuid;
  v_base_due timestamptz;
  v_receipt timestamptz;
  v_checkout_days integer;
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

  select c.user_id, c.borrow_return_due_at, c.member_receipt_confirmed_at, c.checkout_borrow_duration_days
    into v_cart_user, v_base_due, v_receipt, v_checkout_days
  from public.carts c
  where c.id = p_cart_id;

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

  -- Pas encore de réception : les jours sont stockés ; l’échéance sera figée au reçu (+ extensions).
  if v_base_due is null and v_receipt is null then
    return jsonb_build_object('applied', true, 'reason', 'pending_receipt');
  end if;

  if v_base_due is null then
    v_base_due := public.compute_borrow_return_due_at_from_receipt(
      v_receipt,
      v_cart_user,
      v_checkout_days
    );
  end if;

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
$function$;

-- Répare les échéances restées au jour de réception alors qu’une durée checkout existe.
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
where c.deleted_at is null
  and c.member_receipt_confirmed_at is not null
  and c.checkout_borrow_duration_days is not null
  and c.checkout_borrow_duration_days >= 1
  and c.borrow_return_due_at is not null
  and (c.borrow_return_due_at at time zone 'Europe/Paris')::date
    = (c.member_receipt_confirmed_at at time zone 'Europe/Paris')::date;
