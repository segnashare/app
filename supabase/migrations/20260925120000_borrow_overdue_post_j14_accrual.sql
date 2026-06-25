-- PR2 : pénalités post-J+14 jusqu'au plafond 100 % · escalade J+15 sans stop accrue.

create or replace function public.accrue_cart_borrow_overdue_day(
  p_cart_id uuid,
  p_calendar_date date default null,
  p_force_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cart record;
  v_calendar date := coalesce(
    p_calendar_date,
    (timezone('Europe/Paris', now()))::date
  );
  v_late_day integer;
  v_overdue_id uuid;
  v_overdue_status public.cart_borrow_overdue_status;
  v_formal_notice_deadline timestamptz;
  v_rate_bps integer;
  v_penalty_cents bigint;
  v_penalty_credits bigint;
  v_message_key text;
  v_day_id uuid;
  v_charge public.cart_borrow_overdue_day_charge_status;
  v_ret_status text;
  v_dispute_id uuid;
  v_cart_value_cents bigint;
  v_penalty_cap bigint;
  v_penalties_accrued bigint;
begin
  if p_cart_id is null then
    return jsonb_build_object('ok', false, 'error', 'cart_id_required');
  end if;

  select c.id, c.user_id, c.status, c.borrow_return_due_at
    into v_cart
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cart_not_found');
  end if;

  if v_cart.borrow_return_due_at is null then
    return jsonb_build_object('ok', false, 'skipped', 'no_borrow_return_due_at');
  end if;

  if v_cart.status not in (
    'confirmed'::public.cart_status,
    'archived'::public.cart_status,
    'disputed'::public.cart_status
  ) then
    return jsonb_build_object('ok', false, 'skipped', 'cart_status', 'status', v_cart.status);
  end if;

  select s.status
    into v_ret_status
  from public.shipments s
  where s.cart_id = p_cart_id
    and s.context = 'cart_return'
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;

  if v_ret_status is not null
     and lower(v_ret_status::text) in (
       'dropped_out', 'dropped_in', 'in_transit_out', 'in_transit_in',
       'returned', 'en_verification', 'return_validated', 'closed'
     ) then
    update public.cart_borrow_overdue o
    set
      status = 'resolved'::public.cart_borrow_overdue_status,
      recovery_phase = coalesce(
        o.recovery_phase,
        'resolved_return'::public.cart_borrow_overdue_recovery_phase
      ),
      resolution = coalesce(o.resolution, 'return_dropped_out'::public.cart_borrow_overdue_resolution),
      resolved_at = coalesce(o.resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
    where o.cart_id = p_cart_id
      and o.status in (
        'active'::public.cart_borrow_overdue_status,
        'escalated'::public.cart_borrow_overdue_status
      );

    return jsonb_build_object('ok', true, 'skipped', 'return_commitment_met');
  end if;

  v_late_day := public.resolve_cart_borrow_overdue_late_day(v_cart.borrow_return_due_at, v_calendar);

  if v_late_day < 1 then
    return jsonb_build_object('ok', true, 'skipped', 'not_overdue', 'late_day', v_late_day);
  end if;

  v_cart_value_cents := public.resolve_cart_borrow_value_cents(p_cart_id);
  v_penalty_cap := public.borrow_overdue_penalty_cap_cents(v_cart_value_cents);

  select o.id, o.status, o.formal_notice_deadline_at
    into v_overdue_id, v_overdue_status, v_formal_notice_deadline
  from public.cart_borrow_overdue o
  where o.cart_id = p_cart_id
    and o.status in (
      'active'::public.cart_borrow_overdue_status,
      'escalated'::public.cart_borrow_overdue_status
    )
  limit 1;

  if v_overdue_id is null then
    insert into public.cart_borrow_overdue (
      cart_id,
      user_id,
      due_at,
      cart_value_cents,
      opened_on,
      status,
      recovery_phase,
      penalty_cap_cents,
      penalties_accrued_cents
    )
    values (
      p_cart_id,
      v_cart.user_id,
      v_cart.borrow_return_due_at,
      v_cart_value_cents,
      ((v_cart.borrow_return_due_at at time zone 'Europe/Paris')::date + 1),
      'active'::public.cart_borrow_overdue_status,
      'app_restricted'::public.cart_borrow_overdue_recovery_phase,
      v_penalty_cap,
      0
    )
    returning id into v_overdue_id;
  else
    update public.cart_borrow_overdue
    set
      penalty_cap_cents = coalesce(penalty_cap_cents, v_penalty_cap),
      recovery_phase = coalesce(recovery_phase, 'app_restricted'::public.cart_borrow_overdue_recovery_phase),
      updated_at = timezone('utc', now())
    where id = v_overdue_id;
  end if;

  -- Escalade ops J+15 (idempotent) — n'interrompt plus l'accrue des pénalités.
  if v_late_day >= 15 and v_overdue_id is not null then
    update public.cart_borrow_overdue
    set
      status = 'escalated'::public.cart_borrow_overdue_status,
      recovery_phase = 'escalated_ops'::public.cart_borrow_overdue_recovery_phase,
      resolution = 'escalated_dispute'::public.cart_borrow_overdue_resolution,
      updated_at = timezone('utc', now())
    where id = v_overdue_id
      and status = 'active'::public.cart_borrow_overdue_status;

    if not exists (
      select 1 from public.cart_disputes cd
      where cd.cart_id = p_cart_id
        and cd.deleted_at is null
        and cd.reason = 'borrow_return_overdue_escalation'
    ) then
      insert into public.cart_disputes (cart_id, opened_by_user_id, reason, details, status)
      values (
        p_cart_id,
        v_cart.user_id,
        'borrow_return_overdue_escalation',
        jsonb_build_object(
          'late_day_index', v_late_day,
          'calendar_date', v_calendar,
          'due_at', v_cart.borrow_return_due_at
        )::text,
        'open'
      )
      returning id into v_dispute_id;

      update public.cart_borrow_overdue
      set cart_dispute_id = v_dispute_id
      where id = v_overdue_id;

      update public.carts
      set status = 'disputed'::public.cart_status, updated_at = timezone('utc', now())
      where id = p_cart_id
        and status = 'confirmed'::public.cart_status;
    end if;
  end if;

  if v_formal_notice_deadline is not null
     and timezone('utc', now()) > v_formal_notice_deadline then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'formal_notice_deadline_passed',
      'late_day', v_late_day,
      'formal_notice_deadline_at', v_formal_notice_deadline
    );
  end if;

  select coalesce(o.penalties_accrued_cents, 0), coalesce(o.penalty_cap_cents, v_penalty_cap)
    into v_penalties_accrued, v_penalty_cap
  from public.cart_borrow_overdue o
  where o.id = v_overdue_id;

  if v_penalties_accrued >= v_penalty_cap then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'penalty_cap_reached',
      'late_day', v_late_day,
      'penalties_accrued_cents', v_penalties_accrued,
      'penalty_cap_cents', v_penalty_cap
    );
  end if;

  if exists (
    select 1
    from public.cart_borrow_overdue_days d
    where d.cart_id = p_cart_id
      and d.calendar_date = v_calendar
  ) then
    select d.id, d.charge_status, d.late_day_index, d.penalty_cents, d.penalty_credits, d.message_key
      into v_day_id, v_charge, v_late_day, v_penalty_cents, v_penalty_credits, v_message_key
    from public.cart_borrow_overdue_days d
    where d.cart_id = p_cart_id
      and d.calendar_date = v_calendar;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'overdue_id', v_overdue_id,
      'day_id', v_day_id,
      'late_day', v_late_day,
      'charge_status', v_charge
    );
  end if;

  v_rate_bps := public.borrow_overdue_rate_bps(v_late_day);
  select coalesce(o.cart_value_cents, 0) into v_penalty_cents from public.cart_borrow_overdue o where o.id = v_overdue_id;
  v_penalty_cents := round(v_penalty_cents * v_rate_bps / 10000.0)::bigint;

  if v_penalties_accrued + v_penalty_cents > v_penalty_cap then
    v_penalty_cents := greatest(0, v_penalty_cap - v_penalties_accrued);
  end if;

  v_penalty_credits := public.cents_to_borrow_penalty_credits(v_penalty_cents);
  v_message_key := public.borrow_overdue_message_key(v_late_day);

  if coalesce(v_penalty_cents, 0) <= 0 then
    v_charge := 'charged'::public.cart_borrow_overdue_day_charge_status;
  else
    v_charge := 'pending'::public.cart_borrow_overdue_day_charge_status;
  end if;

  insert into public.cart_borrow_overdue_days (
    overdue_id,
    cart_id,
    late_day_index,
    calendar_date,
    rate_bps,
    penalty_cents,
    penalty_credits,
    message_key,
    charge_status
  )
  values (
    v_overdue_id,
    p_cart_id,
    v_late_day,
    v_calendar,
    v_rate_bps,
    v_penalty_cents,
    v_penalty_credits,
    v_message_key,
    v_charge
  )
  returning id into v_day_id;

  update public.cart_borrow_overdue
  set
    penalties_accrued_cents = public.sync_cart_borrow_overdue_penalties_accrued(v_overdue_id),
    updated_at = timezone('utc', now())
  where id = v_overdue_id;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'overdue_id', v_overdue_id,
    'day_id', v_day_id,
    'late_day', v_late_day,
    'rate_bps', v_rate_bps,
    'penalty_cents', v_penalty_cents,
    'penalty_credits', v_penalty_credits,
    'message_key', v_message_key,
    'charge_status', v_charge,
    'penalties_accrued_cents', v_penalties_accrued + v_penalty_cents,
    'penalty_cap_cents', v_penalty_cap,
    'escalated', v_late_day >= 15
  );
end;
$fn$;

comment on function public.accrue_cart_borrow_overdue_day(uuid, date, boolean) is
  'PR2 : pénalités J+1→plafond 100 % (5 % après J+7), escalade J+15 sans stop ; skip après formal_notice_deadline_at.';
