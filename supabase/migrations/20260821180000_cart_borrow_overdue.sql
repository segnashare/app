-- Retards de retour d’emprunt (distinct de cart_disputes = litiges conformité / intake).
-- 1 ligne / jour calendaire (Paris) après borrow_return_due_at ; pénalité 3 % (J1–7) puis 5 % (J8–14).

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_borrow_overdue_status'
  ) then
    create type public.cart_borrow_overdue_status as enum ('active', 'resolved', 'escalated');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_borrow_overdue_resolution'
  ) then
    create type public.cart_borrow_overdue_resolution as enum (
      'return_dropped_out',
      'paid',
      'waived',
      'escalated_dispute'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_borrow_overdue_day_charge_status'
  ) then
    create type public.cart_borrow_overdue_day_charge_status as enum (
      'pending',
      'charged',
      'failed',
      'waived'
    );
  end if;
end $$;

create table if not exists public.cart_borrow_overdue (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  due_at timestamptz not null,
  cart_value_cents bigint not null check (cart_value_cents >= 0),
  opened_on date not null,
  status public.cart_borrow_overdue_status not null default 'active'::public.cart_borrow_overdue_status,
  resolution public.cart_borrow_overdue_resolution,
  resolved_at timestamptz,
  cart_dispute_id uuid references public.cart_disputes (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists cart_borrow_overdue_one_active_cart_uidx
  on public.cart_borrow_overdue (cart_id)
  where status = 'active'::public.cart_borrow_overdue_status;

comment on table public.cart_borrow_overdue is
  'Dossier retard de retour (emprunt) : ouvert au 1er jour calendaire après borrow_return_due_at.';

create index if not exists cart_borrow_overdue_user_status_idx
  on public.cart_borrow_overdue (user_id, status, opened_on desc);

create table if not exists public.cart_borrow_overdue_days (
  id uuid primary key default gen_random_uuid(),
  overdue_id uuid not null references public.cart_borrow_overdue (id) on delete cascade,
  cart_id uuid not null references public.carts (id) on delete cascade,
  late_day_index integer not null check (late_day_index >= 1 and late_day_index <= 60),
  calendar_date date not null,
  rate_bps integer not null check (rate_bps > 0 and rate_bps <= 10000),
  penalty_cents bigint not null check (penalty_cents >= 0),
  penalty_credits bigint not null check (penalty_credits >= 0),
  message_key text not null,
  charge_status public.cart_borrow_overdue_day_charge_status not null
    default 'pending'::public.cart_borrow_overdue_day_charge_status,
  wallet_transaction_id uuid references public.wallet_transactions (id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cart_borrow_overdue_days_overdue_day_uidx unique (overdue_id, late_day_index),
  constraint cart_borrow_overdue_days_cart_calendar_uidx unique (cart_id, calendar_date)
);

comment on table public.cart_borrow_overdue_days is
  'Journal : 1 jour de retard = 1 pénalité (% valeur panier) + message membre.';

create index if not exists cart_borrow_overdue_days_cart_idx
  on public.cart_borrow_overdue_days (cart_id, calendar_date desc);

alter table public.cart_borrow_overdue enable row level security;
alter table public.cart_borrow_overdue_days enable row level security;

drop policy if exists cart_borrow_overdue_select_own on public.cart_borrow_overdue;
create policy cart_borrow_overdue_select_own
  on public.cart_borrow_overdue
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists cart_borrow_overdue_days_select_own on public.cart_borrow_overdue_days;
create policy cart_borrow_overdue_days_select_own
  on public.cart_borrow_overdue_days
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.cart_borrow_overdue o
      where o.id = overdue_id
        and o.user_id = auth.uid()
    )
  );

-- Valeur panier pour les % : crédits échange (price_points × 5 cts), repli facture Stripe TTC.
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
        select greatest(0, sum(coalesce(i.price_points, 0))::bigint * 5)
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
  'Base pénalités retard : somme price_points×5 cts, sinon montant TTC facture panier.';

create or replace function public.borrow_overdue_rate_bps(p_late_day_index integer)
returns integer
language sql
immutable
as $$
  select case
    when p_late_day_index is null or p_late_day_index < 1 then 300
    when p_late_day_index <= 7 then 300
    when p_late_day_index <= 14 then 500
    else 500
  end;
$$;

create or replace function public.cents_to_borrow_penalty_credits(p_cents bigint)
returns bigint
language sql
immutable
as $$
  select case
    when coalesce(p_cents, 0) <= 0 then 0::bigint
    else ((p_cents + 4) / 5)::bigint
  end;
$$;

create or replace function public.borrow_overdue_message_key(p_late_day_index integer)
returns text
language sql
immutable
as $$
  select 'borrow_overdue_day_' || greatest(1, least(coalesce(p_late_day_index, 1), 60))::text;
$$;

create or replace function public.resolve_cart_borrow_overdue_late_day(
  p_due_at timestamptz,
  p_calendar_date date
)
returns integer
language sql
immutable
as $$
  select (
    p_calendar_date
    - ((p_due_at at time zone 'Europe/Paris')::date)
  )::integer;
$$;

comment on function public.resolve_cart_borrow_overdue_late_day(timestamptz, date) is
  'Index jour de retard (1 = 1er jour après la date limite Paris).';

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

    if not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_idem) then
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
        insert into public.wallet_transactions (
          user_id,
          kind,
          direction,
          amount_points,
          status,
          idempotency_key,
          metadata,
          credit_bucket
        )
        values (
          v_cart.user_id,
          'borrow_overdue_penalty',
          'debit',
          v_penalty_credits,
          'posted',
          v_idem,
          jsonb_build_object(
            'source', 'borrow_overdue',
            'cart_id', p_cart_id,
            'overdue_id', v_overdue_id,
            'day_id', v_day_id,
            'late_day_index', v_late_day,
            'calendar_date', v_calendar,
            'penalty_cents', v_penalty_cents,
            'rate_bps', v_rate_bps,
            'debit_split', jsonb_build_object(
              'exchange_points', v_debit_ex,
              'consumption_points', v_debit_co
            )
          ),
          case
            when v_debit_ex > 0 and v_debit_co > 0 then 'mixed'
            when v_debit_ex > 0 then 'exchange'
            else 'consumption'
          end
        )
        returning id into v_tx_id;

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
      end if;
    else
      select wt.id into v_tx_id from public.wallet_transactions wt where wt.idempotency_key = v_idem;
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

comment on function public.accrue_cart_borrow_overdue_day(uuid, date, boolean) is
  'Cron / service_role : journalise 1 jour de retard, tente débit wallet, escalade cart_disputes après J14.';

revoke all on function public.accrue_cart_borrow_overdue_day(uuid, date, boolean) from public;
grant execute on function public.accrue_cart_borrow_overdue_day(uuid, date, boolean) to service_role;

grant execute on function public.resolve_cart_borrow_value_cents(uuid) to service_role;
grant execute on function public.borrow_overdue_rate_bps(integer) to service_role;
