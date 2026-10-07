-- Caution location : préautorisation Stripe 100 € si le total des paniers actifs > 500 €.

create table if not exists public.member_rental_deposit_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origin_cart_id uuid not null references public.carts (id) on delete cascade,
  stripe_payment_intent_id text not null,
  amount_cents integer not null default 10000,
  active_value_cents integer not null,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  released_at timestamptz,
  constraint member_rental_deposit_holds_amount_check check (amount_cents > 0),
  constraint member_rental_deposit_holds_status_check check (
    status in ('requires_capture', 'requires_action', 'canceled', 'captured', 'failed')
  )
);

create unique index if not exists member_rental_deposit_holds_open_user_uidx
  on public.member_rental_deposit_holds (user_id)
  where status in ('requires_capture', 'requires_action');

create unique index if not exists member_rental_deposit_holds_pi_uidx
  on public.member_rental_deposit_holds (stripe_payment_intent_id);

create index if not exists member_rental_deposit_holds_origin_cart_idx
  on public.member_rental_deposit_holds (origin_cart_id);

alter table public.member_rental_deposit_holds enable row level security;

drop policy if exists member_rental_deposit_holds_select_own on public.member_rental_deposit_holds;
create policy member_rental_deposit_holds_select_own
  on public.member_rental_deposit_holds
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.member_rental_deposit_holds is
  'Préautorisation caution 100 € (capture_method manual) quand le total des locations actives dépasse 500 €.';
