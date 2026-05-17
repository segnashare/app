-- Prolongations de location payées (Stripe Checkout).
create table if not exists public.cart_borrow_extensions (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  extension_days integer not null,
  credits_charged integer not null,
  amount_cents integer not null,
  cart_item_ids uuid[] not null default '{}',
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cart_borrow_extensions_days_check check (extension_days >= 1 and extension_days <= 60),
  constraint cart_borrow_extensions_credits_check check (credits_charged > 0),
  constraint cart_borrow_extensions_amount_check check (amount_cents > 0)
);

create unique index if not exists cart_borrow_extensions_stripe_session_uidx
  on public.cart_borrow_extensions (stripe_checkout_session_id);

create index if not exists cart_borrow_extensions_cart_id_idx
  on public.cart_borrow_extensions (cart_id);

alter table public.cart_borrow_extensions enable row level security;

drop policy if exists cart_borrow_extensions_select_own on public.cart_borrow_extensions;
create policy cart_borrow_extensions_select_own
  on public.cart_borrow_extensions
  for select
  to authenticated
  using (auth.uid() = user_id);

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

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.apply_cart_borrow_extension(
  uuid, uuid, integer, integer, integer, uuid[], text, text
) from public;
grant execute on function public.apply_cart_borrow_extension(
  uuid, uuid, integer, integer, integer, uuid[], text, text
) to service_role;
