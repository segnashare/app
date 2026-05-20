-- Débit wallet sans credit_bucket=mixed ; colonne Stripe pour prélèvement off-session (TS cron).

alter table public.cart_borrow_overdue_days
  add column if not exists stripe_payment_intent_id text;

comment on column public.cart_borrow_overdue_days.stripe_payment_intent_id is
  'PaymentIntent Stripe si pénalité prélevée sur carte (wallet insuffisant).';

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
  v_rate_bps integer;
  v_penalty_cents bigint;
  v_penalty_credits bigint;
  v_message_key text;
  v_day_id uuid;
  v_charge public.cart_borrow_overdue_day_charge_status;
  v_wallet_id uuid;
  v_ex_bal bigint;
  v_co_bal bigint;
  v_debit_ex bigint;
  v_debit_co bigint;
  v_tx_id uuid;
  v_idem text;
  v_ret_status text;
  v_dispute_id uuid;
  v_meta_base jsonb;
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

  if v_cart.status not in ('confirmed'::public.cart_status, 'archived'::public.cart_status) then
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
     and lower(v_ret_status::text) in ('dropped_out', 'dropped_in', 'in_transit_out', 'in_transit_in', 'returned', 'en_verification', 'return_validated', 'closed') then
    update public.cart_borrow_overdue o
    set
      status = 'resolved'::public.cart_borrow_overdue_status,
      resolution = coalesce(o.resolution, 'return_dropped_out'::public.cart_borrow_overdue_resolution),
      resolved_at = coalesce(o.resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
    where o.cart_id = p_cart_id
      and o.status = 'active'::public.cart_borrow_overdue_status;

    return jsonb_build_object('ok', true, 'skipped', 'return_commitment_met');
  end if;

  v_late_day := public.resolve_cart_borrow_overdue_late_day(v_cart.borrow_return_due_at, v_calendar);

  if v_late_day < 1 then
    return jsonb_build_object('ok', true, 'skipped', 'not_overdue', 'late_day', v_late_day);
  end if;

  if v_late_day > 14 then
    select o.id into v_overdue_id
    from public.cart_borrow_overdue o
    where o.cart_id = p_cart_id;

    if v_overdue_id is not null then
      update public.cart_borrow_overdue
      set
        status = 'escalated'::public.cart_borrow_overdue_status,
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

    return jsonb_build_object('ok', true, 'skipped', 'beyond_day_14', 'late_day', v_late_day, 'escalated', true);
  end if;

  select o.id into v_overdue_id
  from public.cart_borrow_overdue o
  where o.cart_id = p_cart_id
    and o.status = 'active'::public.cart_borrow_overdue_status
  limit 1;

  if v_overdue_id is null then
    insert into public.cart_borrow_overdue (
      cart_id,
      user_id,
      due_at,
      cart_value_cents,
      opened_on,
      status
    )
    values (
      p_cart_id,
      v_cart.user_id,
      v_cart.borrow_return_due_at,
      public.resolve_cart_borrow_value_cents(p_cart_id),
      ((v_cart.borrow_return_due_at at time zone 'Europe/Paris')::date + 1),
      'active'::public.cart_borrow_overdue_status
    )
    returning id into v_overdue_id;
  else
    update public.cart_borrow_overdue
    set updated_at = timezone('utc', now())
    where id = v_overdue_id;
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
  v_penalty_credits := public.cents_to_borrow_penalty_credits(v_penalty_cents);
  v_message_key := public.borrow_overdue_message_key(v_late_day);
  v_charge := 'pending'::public.cart_borrow_overdue_day_charge_status;

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

  if v_penalty_credits > 0 then
    v_idem := 'borrow_overdue:' || p_cart_id::text || ':' || v_calendar::text;
    v_meta_base := jsonb_build_object(
      'source', 'borrow_overdue',
      'cart_id', p_cart_id,
      'overdue_id', v_overdue_id,
      'day_id', v_day_id,
      'late_day_index', v_late_day,
      'calendar_date', v_calendar,
      'penalty_cents', v_penalty_cents,
      'rate_bps', v_rate_bps
    );

    if not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_idem || ':exchange')
       and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_idem || ':consumption')
       and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_idem) then
      if not exists (
        select 1 from public.user_wallets uw where uw.user_id = v_cart.user_id and uw.deleted_at is null
      ) then
        insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
        values (v_cart.user_id, 0, 0);
      end if;

      select uw.id, uw.balance_exchange_points, uw.balance_consumption_points
        into v_wallet_id, v_ex_bal, v_co_bal
      from public.user_wallets uw
      where uw.user_id = v_cart.user_id
        and uw.deleted_at is null
      order by uw.updated_at desc
      limit 1
      for update;

      v_debit_ex := least(coalesce(v_ex_bal, 0), v_penalty_credits);
      v_debit_co := least(coalesce(v_co_bal, 0), v_penalty_credits - v_debit_ex);

      if v_debit_ex + v_debit_co >= v_penalty_credits then
        if v_debit_ex > 0 then
          insert into public.wallet_transactions (
            user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
          )
          values (
            v_cart.user_id,
            'borrow_overdue_penalty',
            'debit',
            v_debit_ex,
            'posted',
            v_idem || ':exchange',
            v_meta_base || jsonb_build_object(
              'debit_split', jsonb_build_object('exchange_points', v_debit_ex, 'consumption_points', 0),
              'cart_debit_component', 'exchange'
            ),
            'exchange'
          )
          returning id into v_tx_id;
        end if;

        if v_debit_co > 0 then
          insert into public.wallet_transactions (
            user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
          )
          values (
            v_cart.user_id,
            'borrow_overdue_penalty',
            'debit',
            v_debit_co,
            'posted',
            v_idem || ':consumption',
            v_meta_base || jsonb_build_object(
              'debit_split', jsonb_build_object('exchange_points', 0, 'consumption_points', v_debit_co),
              'cart_debit_component', 'consumption'
            ),
            'consumption'
          )
          returning id into v_tx_id;
        end if;

        update public.user_wallets
        set
          balance_exchange_points = balance_exchange_points - v_debit_ex,
          balance_consumption_points = balance_consumption_points - v_debit_co,
          balance_points = coalesce(balance_points, 0) - v_penalty_credits,
          updated_at = timezone('utc', now())
        where id = v_wallet_id;

        v_charge := 'charged'::public.cart_borrow_overdue_day_charge_status;
      else
        v_charge := 'failed'::public.cart_borrow_overdue_day_charge_status;
        v_tx_id := null;
      end if;
    else
      select wt.id into v_tx_id
      from public.wallet_transactions wt
      where wt.idempotency_key in (v_idem, v_idem || ':exchange', v_idem || ':consumption')
      order by wt.created_at desc
      limit 1;
      v_charge := 'charged'::public.cart_borrow_overdue_day_charge_status;
    end if;

    update public.cart_borrow_overdue_days
    set
      charge_status = v_charge,
      wallet_transaction_id = v_tx_id,
      notified_at = case when p_force_notify then timezone('utc', now()) else notified_at end
    where id = v_day_id;
  end if;

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
    'charge_status', v_charge
  );
end;
$fn$;
