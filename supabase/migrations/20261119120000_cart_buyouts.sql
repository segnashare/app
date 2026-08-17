-- Achat de pièces en cours de location (buyout partiel ou total).
create table if not exists public.cart_buyouts (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount_cents integer not null,
  discount_percent integer not null default 0,
  retail_cents integer not null,
  cart_item_ids uuid[] not null default '{}',
  item_ids uuid[] not null default '{}',
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cart_buyouts_amount_check check (amount_cents > 0),
  constraint cart_buyouts_retail_check check (retail_cents > 0),
  constraint cart_buyouts_discount_check check (discount_percent >= 0 and discount_percent <= 100)
);

create unique index if not exists cart_buyouts_stripe_session_uidx
  on public.cart_buyouts (stripe_checkout_session_id);

create index if not exists cart_buyouts_cart_id_idx
  on public.cart_buyouts (cart_id);

alter table public.cart_buyouts enable row level security;

drop policy if exists cart_buyouts_select_own on public.cart_buyouts;
create policy cart_buyouts_select_own
  on public.cart_buyouts
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.apply_cart_buyout(
  p_user_id uuid,
  p_cart_id uuid,
  p_amount_cents integer,
  p_discount_percent integer,
  p_retail_cents integer,
  p_cart_item_ids uuid[],
  p_item_ids uuid[],
  p_checkout_session_id text,
  p_payment_intent_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart record;
  v_expected_items integer;
  v_matched_items integer;
  v_remaining_reserved integer;
begin
  if p_checkout_session_id is null or trim(p_checkout_session_id) = '' then
    return jsonb_build_object('applied', false, 'reason', 'missing_session');
  end if;

  if exists (
    select 1 from public.cart_buyouts b
    where b.stripe_checkout_session_id = p_checkout_session_id
  ) then
    return jsonb_build_object('applied', true, 'reason', 'already_applied');
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_amount');
  end if;
  if p_retail_cents is null or p_retail_cents <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_retail');
  end if;
  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent > 100 then
    return jsonb_build_object('applied', false, 'reason', 'invalid_discount');
  end if;
  if p_cart_item_ids is null or cardinality(p_cart_item_ids) = 0 then
    return jsonb_build_object('applied', false, 'reason', 'empty_selection');
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    return jsonb_build_object('applied', false, 'reason', 'empty_items');
  end if;
  if cardinality(p_cart_item_ids) <> cardinality(p_item_ids) then
    return jsonb_build_object('applied', false, 'reason', 'selection_mismatch');
  end if;

  select
    c.id,
    c.user_id,
    c.status,
    coalesce(c.checkout_purchase_mode, false) as checkout_purchase_mode
  into v_cart
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null;

  if v_cart.id is null then
    return jsonb_build_object('applied', false, 'reason', 'cart_not_found');
  end if;
  if v_cart.user_id is distinct from p_user_id then
    return jsonb_build_object('applied', false, 'reason', 'forbidden');
  end if;
  if v_cart.status is distinct from 'confirmed'::public.cart_status then
    return jsonb_build_object('applied', false, 'reason', 'cart_not_confirmed');
  end if;
  if v_cart.checkout_purchase_mode is true then
    return jsonb_build_object('applied', false, 'reason', 'purchase_order');
  end if;

  v_expected_items := cardinality(p_cart_item_ids);

  select count(*)::integer into v_matched_items
  from public.cart_items ci
  join public.items i on i.id = ci.item_id and i.deleted_at is null
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.id = any (p_cart_item_ids)
    and ci.item_id = any (p_item_ids)
    and ci.status = 'reserved'::public.cart_item_status
    and i.status = 'reserved'::public.item_status
    and coalesce(ci.dispute_line_status, '') is distinct from 'lost_not_returned';

  if v_matched_items is distinct from v_expected_items then
    return jsonb_build_object('applied', false, 'reason', 'items_unavailable');
  end if;

  insert into public.cart_buyouts (
    cart_id,
    user_id,
    amount_cents,
    discount_percent,
    retail_cents,
    cart_item_ids,
    item_ids,
    stripe_checkout_session_id,
    stripe_payment_intent_id
  ) values (
    p_cart_id,
    p_user_id,
    p_amount_cents,
    p_discount_percent,
    p_retail_cents,
    p_cart_item_ids,
    p_item_ids,
    p_checkout_session_id,
    nullif(trim(p_payment_intent_id), '')
  );

  update public.items i
  set
    status = 'sold'::public.item_status,
    updated_at = timezone('utc', now())
  where i.id = any (p_item_ids)
    and i.status = 'reserved'::public.item_status
    and i.deleted_at is null;

  select count(*)::integer into v_remaining_reserved
  from public.cart_items ci
  join public.items i on i.id = ci.item_id and i.deleted_at is null
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.status = 'reserved'::public.cart_item_status
    and i.status = 'reserved'::public.item_status;

  if coalesce(v_remaining_reserved, 0) = 0 then
    update public.carts
    set
      status = 'archived'::public.cart_status,
      updated_at = timezone('utc', now())
    where id = p_cart_id
      and status = 'confirmed'::public.cart_status;

    insert into public.cart_status_history (
      cart_id,
      from_status,
      to_status,
      reason,
      actor_user_id
    ) values (
      p_cart_id,
      'confirmed'::public.cart_status,
      'archived'::public.cart_status,
      'rental_buyout_complete',
      p_user_id
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'archived', coalesce(v_remaining_reserved, 0) = 0,
    'remaining_reserved', coalesce(v_remaining_reserved, 0)
  );
end;
$$;

revoke all on function public.apply_cart_buyout(
  uuid, uuid, integer, integer, integer, uuid[], uuid[], text, text
) from public;
grant execute on function public.apply_cart_buyout(
  uuid, uuid, integer, integer, integer, uuid[], uuid[], text, text
) to service_role;
