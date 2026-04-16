-- Snapshot par panier : total mods et répartition débit exchange / consumption.
-- Alimenté par trigger sur les débits wallet `source = cart_order_stripe`.

create table if not exists public.cart_payments (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_transaction_id uuid references public.wallet_transactions (id) on delete set null,
  total_points bigint not null check (total_points >= 0),
  exchange_points bigint not null default 0 check (exchange_points >= 0),
  consumption_points bigint not null default 0 check (consumption_points >= 0),
  check (exchange_points + consumption_points = total_points),
  stripe_wallet_topup_points bigint not null default 0 check (stripe_wallet_topup_points >= 0),
  stripe_wallet_topup_kind text null,
  stripe_checkout_session_id text null,
  payment_channel text not null check (payment_channel in ('stripe', 'wallet_only')),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.cart_payments is
  'Paiement panier en points : total mods et détail exchange vs consumption (débit wallet cart_order_stripe).';

comment on column public.cart_payments.total_points is
  'Somme des price_points débités (= amount_points du wallet_transactions lié).';

comment on column public.cart_payments.stripe_wallet_topup_points is
  'Mods achetés via Stripe juste avant le débit (metadata stripe_wallet_comp_points), sinon 0.';

create index if not exists cart_payments_cart_id_idx on public.cart_payments (cart_id);
create index if not exists cart_payments_user_id_idx on public.cart_payments (user_id);
create index if not exists cart_payments_created_at_idx on public.cart_payments (created_at desc);

alter table public.cart_payments enable row level security;

create policy cart_payments_select_own
  on public.cart_payments
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.cart_payments to authenticated;
grant all on public.cart_payments to service_role;

-- ---------------------------------------------------------------------------
-- Trigger : une ligne cart_payments par débit panier (idempotency = clé wallet).
-- ---------------------------------------------------------------------------

create or replace function public.cart_payments_from_wallet_debit()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_cart_id uuid;
  v_split jsonb;
  v_ex bigint;
  v_co bigint;
  v_total bigint;
  v_bucket text;
  v_topup bigint;
  v_topup_kind text;
  v_session text;
  v_channel text;
begin
  if new.kind is distinct from 'debit' or new.direction is distinct from 'debit' then
    return new;
  end if;

  if coalesce(new.metadata ->> 'source', '') <> 'cart_order_stripe' then
    return new;
  end if;

  begin
    v_cart_id := (nullif(trim(new.metadata ->> 'cart_id'), ''))::uuid;
  exception
    when others then
      return new;
  end;

  if v_cart_id is null then
    return new;
  end if;

  if not exists (select 1 from public.carts c where c.id = v_cart_id) then
    return new;
  end if;

  v_total := greatest(0, coalesce(new.amount_points, 0)::bigint);
  v_split := new.metadata -> 'debit_split';
  if v_split is not null and jsonb_typeof(v_split) = 'object' then
    v_ex := greatest(0, coalesce(nullif(v_split ->> 'exchange_points', '')::bigint, 0));
    v_co := greatest(0, coalesce(nullif(v_split ->> 'consumption_points', '')::bigint, 0));
  else
    v_ex := 0;
    v_co := 0;
  end if;

  if v_ex + v_co <> v_total then
    v_bucket := lower(coalesce(new.credit_bucket, ''));
    if v_bucket = 'exchange' then
      v_ex := v_total;
      v_co := 0;
    elsif v_bucket = 'consumption' then
      v_ex := 0;
      v_co := v_total;
    elsif v_bucket = 'mixed' then
      raise warning 'cart_payments: debit_split manquant pour credit_bucket=mixed, cart_id=%', v_cart_id;
      return new;
    else
      v_ex := v_total;
      v_co := 0;
    end if;
  end if;

  v_topup := 0;
  begin
    if new.metadata ? 'stripe_wallet_comp_points' then
      if jsonb_typeof(new.metadata -> 'stripe_wallet_comp_points') = 'number' then
        v_topup := greatest(0, (new.metadata ->> 'stripe_wallet_comp_points')::bigint);
      elsif nullif(trim(new.metadata ->> 'stripe_wallet_comp_points'), '') is not null then
        v_topup := greatest(0, nullif(trim(new.metadata ->> 'stripe_wallet_comp_points'), '')::bigint);
      end if;
    end if;
  exception
    when others then
      v_topup := 0;
  end;

  v_topup_kind := nullif(trim(new.metadata ->> 'stripe_wallet_comp_credits_kind'), '');
  v_session := nullif(trim(new.metadata ->> 'checkout_session_id'), '');

  if new.idempotency_key like 'wallet_only:%' or coalesce(new.metadata ->> 'checkout_mode', '') = 'wallet_only' then
    v_channel := 'wallet_only';
    v_session := null;
  else
    v_channel := 'stripe';
  end if;

  insert into public.cart_payments (
    cart_id,
    user_id,
    wallet_transaction_id,
    total_points,
    exchange_points,
    consumption_points,
    stripe_wallet_topup_points,
    stripe_wallet_topup_kind,
    stripe_checkout_session_id,
    payment_channel,
    idempotency_key,
    metadata
  )
  values (
    v_cart_id,
    new.user_id,
    new.id,
    v_total,
    v_ex,
    v_co,
    v_topup,
    v_topup_kind,
    v_session,
    v_channel,
    new.idempotency_key,
    coalesce(new.metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$fn$;

comment on function public.cart_payments_from_wallet_debit() is
  'Insère cart_payments après débit wallet panier (metadata source cart_order_stripe).';

drop trigger if exists trg_wallet_transactions_cart_payments on public.wallet_transactions;

create trigger trg_wallet_transactions_cart_payments
after insert on public.wallet_transactions
for each row
execute function public.cart_payments_from_wallet_debit();

-- ---------------------------------------------------------------------------
-- Backfill : débits panier déjà présents.
-- ---------------------------------------------------------------------------

insert into public.cart_payments (
  cart_id,
  user_id,
  wallet_transaction_id,
  total_points,
  exchange_points,
  consumption_points,
  stripe_wallet_topup_points,
  stripe_wallet_topup_kind,
  stripe_checkout_session_id,
  payment_channel,
  idempotency_key,
  metadata,
  created_at
)
select
  b.cart_id,
  b.user_id,
  b.tx_id,
  b.total_points,
  b.exchange_points,
  b.consumption_points,
  b.stripe_wallet_topup_points,
  b.stripe_wallet_topup_kind,
  b.stripe_checkout_session_id,
  b.payment_channel,
  b.idempotency_key,
  b.metadata,
  b.created_at
from (
  select
    (nullif(trim(wt.metadata ->> 'cart_id'), ''))::uuid as cart_id,
    wt.user_id,
    wt.id as tx_id,
    greatest(0, coalesce(wt.amount_points, 0)::bigint) as total_points,
    case
      when
        greatest(0, coalesce(nullif(trim(wt.metadata -> 'debit_split' ->> 'exchange_points'), '')::bigint, 0))
        + greatest(0, coalesce(nullif(trim(wt.metadata -> 'debit_split' ->> 'consumption_points'), '')::bigint, 0))
        = greatest(0, coalesce(wt.amount_points, 0)::bigint)
      then greatest(0, coalesce(nullif(trim(wt.metadata -> 'debit_split' ->> 'exchange_points'), '')::bigint, 0))
      when lower(coalesce(wt.credit_bucket, '')) = 'consumption' then 0::bigint
      when lower(coalesce(wt.credit_bucket, '')) = 'mixed' then null::bigint
      else greatest(0, coalesce(wt.amount_points, 0)::bigint)
    end as exchange_points,
    case
      when
        greatest(0, coalesce(nullif(trim(wt.metadata -> 'debit_split' ->> 'exchange_points'), '')::bigint, 0))
        + greatest(0, coalesce(nullif(trim(wt.metadata -> 'debit_split' ->> 'consumption_points'), '')::bigint, 0))
        = greatest(0, coalesce(wt.amount_points, 0)::bigint)
      then greatest(0, coalesce(nullif(trim(wt.metadata -> 'debit_split' ->> 'consumption_points'), '')::bigint, 0))
      when lower(coalesce(wt.credit_bucket, '')) = 'consumption' then greatest(0, coalesce(wt.amount_points, 0)::bigint)
      when lower(coalesce(wt.credit_bucket, '')) = 'mixed' then null::bigint
      else 0::bigint
    end as consumption_points,
    greatest(
      0,
      coalesce(
        nullif(trim(wt.metadata ->> 'stripe_wallet_comp_points'), '')::bigint,
        case
          when jsonb_typeof(wt.metadata -> 'stripe_wallet_comp_points') = 'number'
            then (wt.metadata ->> 'stripe_wallet_comp_points')::bigint
          else 0::bigint
        end
      )
    ) as stripe_wallet_topup_points,
    nullif(trim(wt.metadata ->> 'stripe_wallet_comp_credits_kind'), '') as stripe_wallet_topup_kind,
    nullif(trim(wt.metadata ->> 'checkout_session_id'), '') as stripe_checkout_session_id,
    case
      when wt.idempotency_key like 'wallet_only:%' or coalesce(wt.metadata ->> 'checkout_mode', '') = 'wallet_only' then 'wallet_only'
      else 'stripe'
    end as payment_channel,
    wt.idempotency_key,
    coalesce(wt.metadata, '{}'::jsonb) as metadata,
    wt.created_at
  from public.wallet_transactions wt
  where wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and exists (
      select 1
      from public.carts c
      where c.id = (nullif(trim(wt.metadata ->> 'cart_id'), ''))::uuid
    )
) b
where b.exchange_points is not null
  and b.consumption_points is not null
on conflict (idempotency_key) do nothing;

-- Corrige les anciennes lignes sans debit_split cohérent (hors mixed).
update public.cart_payments cp
set
  exchange_points = case
    when lower(wt.credit_bucket) = 'consumption' then 0
    else cp.total_points
  end,
  consumption_points = case
    when lower(wt.credit_bucket) = 'consumption' then cp.total_points
    else 0
  end
from public.wallet_transactions wt
where cp.wallet_transaction_id = wt.id
  and lower(coalesce(wt.credit_bucket, '')) <> 'mixed'
  and cp.exchange_points + cp.consumption_points <> cp.total_points;
