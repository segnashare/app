-- PR1 : fondations non-retour (recovery_phase, tables MED/charges, RPC disputed + retour escaladé).

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_borrow_overdue_recovery_phase'
  ) then
    create type public.cart_borrow_overdue_recovery_phase as enum (
      'app_restricted',
      'escalated_ops',
      'formal_notice_pending',
      'formal_notice_sent',
      'non_restitution_due',
      'non_restitution_charged',
      'payment_recovery',
      'collection',
      'resolved_return',
      'resolved_paid',
      'waived'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_borrow_recovery_status'
  ) then
    create type public.cart_borrow_recovery_status as enum (
      'none',
      'retry_scheduled',
      'requires_action',
      'recovery_required',
      'collection'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_borrow_non_restitution_charge_status'
  ) then
    create type public.cart_borrow_non_restitution_charge_status as enum (
      'pending',
      'succeeded',
      'failed',
      'requires_action',
      'refunded_partial'
    );
  end if;
end $$;

alter table public.cart_borrow_overdue
  add column if not exists recovery_phase public.cart_borrow_overdue_recovery_phase,
  add column if not exists formal_notice_sent_at timestamptz,
  add column if not exists formal_notice_deadline_at timestamptz,
  add column if not exists penalty_cap_cents bigint,
  add column if not exists penalties_accrued_cents bigint not null default 0,
  add column if not exists non_restitution_charge_cents bigint,
  add column if not exists processing_fee_cents bigint,
  add column if not exists non_restitution_pi_id text,
  add column if not exists recovery_status public.cart_borrow_recovery_status not null
    default 'none'::public.cart_borrow_recovery_status,
  add column if not exists recovery_next_attempt_at timestamptz,
  add column if not exists recovery_attempt_count integer not null default 0;

comment on column public.cart_borrow_overdue.recovery_phase is
  'Parcours non-retour : app_restricted (J+1), escalated_ops (J+15), formal_notice_sent (J+21), …';

alter table public.cart_borrow_overdue
  drop constraint if exists cart_borrow_overdue_penalty_cap_nonneg_chk;

alter table public.cart_borrow_overdue
  add constraint cart_borrow_overdue_penalty_cap_nonneg_chk
  check (penalty_cap_cents is null or penalty_cap_cents >= 0);

alter table public.cart_borrow_overdue
  drop constraint if exists cart_borrow_overdue_penalties_accrued_nonneg_chk;

alter table public.cart_borrow_overdue
  add constraint cart_borrow_overdue_penalties_accrued_nonneg_chk
  check (penalties_accrued_cents >= 0);

create table if not exists public.cart_borrow_formal_notices (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  overdue_id uuid not null references public.cart_borrow_overdue (id) on delete cascade,
  sent_at timestamptz not null default timezone('utc', now()),
  deadline_at timestamptz not null,
  channel text not null default 'email',
  template_version text not null default 'v1',
  member_email_snapshot text,
  payload jsonb not null default '{}'::jsonb,
  ar24_message_id text,
  ar24_proof_url text,
  ar24_status text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists cart_borrow_formal_notices_cart_idx
  on public.cart_borrow_formal_notices (cart_id, sent_at desc);

create table if not exists public.cart_borrow_non_restitution_charges (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  overdue_id uuid not null references public.cart_borrow_overdue (id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  processing_fee_cents bigint not null default 0 check (processing_fee_cents >= 0),
  stripe_payment_intent_id text,
  status public.cart_borrow_non_restitution_charge_status not null
    default 'pending'::public.cart_borrow_non_restitution_charge_status,
  attempt_number integer not null default 1 check (attempt_number >= 1),
  failure_code text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists cart_borrow_non_restitution_charges_overdue_idx
  on public.cart_borrow_non_restitution_charges (overdue_id, created_at desc);

alter table public.cart_borrow_formal_notices enable row level security;
alter table public.cart_borrow_non_restitution_charges enable row level security;

drop policy if exists cart_borrow_formal_notices_select_own on public.cart_borrow_formal_notices;
create policy cart_borrow_formal_notices_select_own on public.cart_borrow_formal_notices
  for select to authenticated
  using (
    exists (
      select 1 from public.carts c
      where c.id = cart_id and c.user_id = auth.uid() and c.deleted_at is null
    )
  );

drop policy if exists cart_borrow_non_restitution_charges_select_own on public.cart_borrow_non_restitution_charges;
create policy cart_borrow_non_restitution_charges_select_own on public.cart_borrow_non_restitution_charges
  for select to authenticated
  using (
    exists (
      select 1 from public.carts c
      where c.id = cart_id and c.user_id = auth.uid() and c.deleted_at is null
    )
  );

create or replace function public.borrow_non_return_processing_fee_cents(p_cart_value_cents bigint)
returns bigint
language sql
immutable
as $$
  select case
    when coalesce(p_cart_value_cents, 0) < 10000 then 1999::bigint
    else 2999::bigint
  end;
$$;

comment on function public.borrow_non_return_processing_fee_cents(bigint) is
  'Frais de traitement non-retour TTC : 19,99 € si panier < 100 €, sinon 29,99 €.';

create or replace function public.borrow_overdue_penalty_cap_cents(p_cart_value_cents bigint)
returns bigint
language sql
immutable
as $$
  select greatest(0, coalesce(p_cart_value_cents, 0))::bigint;
$$;

comment on function public.borrow_overdue_penalty_cap_cents(bigint) is
  'Plafond frais de retard = 100 % de la valeur panier.';

create or replace function public.sync_cart_borrow_overdue_penalties_accrued(p_overdue_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(d.penalty_cents), 0)::bigint
  from public.cart_borrow_overdue_days d
  where d.overdue_id = p_overdue_id;
$$;

-- Backfill colonnes recovery sur dossiers existants.
update public.cart_borrow_overdue o
set
  penalty_cap_cents = coalesce(o.penalty_cap_cents, public.borrow_overdue_penalty_cap_cents(o.cart_value_cents)),
  penalties_accrued_cents = public.sync_cart_borrow_overdue_penalties_accrued(o.id),
  recovery_phase = coalesce(
    o.recovery_phase,
    case
      when o.status = 'escalated'::public.cart_borrow_overdue_status then 'escalated_ops'::public.cart_borrow_overdue_recovery_phase
      when o.status = 'resolved'::public.cart_borrow_overdue_status then 'resolved_return'::public.cart_borrow_overdue_recovery_phase
      else 'app_restricted'::public.cart_borrow_overdue_recovery_phase
    end
  )
where o.recovery_phase is null or o.penalty_cap_cents is null;

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

  if v_late_day > 14 then
    select o.id, o.status into v_overdue_id, v_overdue_status
    from public.cart_borrow_overdue o
    where o.cart_id = p_cart_id;

    if v_overdue_id is not null then
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

    return jsonb_build_object('ok', true, 'skipped', 'beyond_day_14', 'late_day', v_late_day, 'escalated', true);
  end if;

  select o.id, o.status
    into v_overdue_id, v_overdue_status
  from public.cart_borrow_overdue o
  where o.cart_id = p_cart_id
    and o.status = 'active'::public.cart_borrow_overdue_status
  limit 1;

  v_cart_value_cents := public.resolve_cart_borrow_value_cents(p_cart_id);
  v_penalty_cap := public.borrow_overdue_penalty_cap_cents(v_cart_value_cents);

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

  if p_force_notify and v_charge = 'pending'::public.cart_borrow_overdue_day_charge_status then
    update public.cart_borrow_overdue_days
    set notified_at = timezone('utc', now())
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
    'charge_status', v_charge,
    'penalties_accrued_cents', v_penalties_accrued + v_penalty_cents,
    'penalty_cap_cents', v_penalty_cap
  );
end;
$fn$;

comment on function public.accrue_cart_borrow_overdue_day(uuid, date, boolean) is
  'Journalise 1 jour de retard ; paniers disputed acceptés ; retour résout active/escalated ; plafond pénalités 100 %.';

grant execute on function public.borrow_non_return_processing_fee_cents(bigint) to service_role;
grant execute on function public.borrow_overdue_penalty_cap_cents(bigint) to service_role;
grant execute on function public.sync_cart_borrow_overdue_penalties_accrued(uuid) to service_role;
