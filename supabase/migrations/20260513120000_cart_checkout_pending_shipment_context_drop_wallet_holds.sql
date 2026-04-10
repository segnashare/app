-- Panier : statuts métier (checkout_pending, confirmed), plus de wallet_holds.
-- Expéditions : contexte (panier aller/retour, intake/outtake) et cart_id nullable.

-- 1) shipment_context + shipments
do $body$
begin
  create type public.shipment_context as enum (
    'cart_outbound',
    'cart_return',
    'member_intake',
    'member_outtake',
    'other'
  );
exception
  when duplicate_object then null;
end $body$;

alter table public.shipments
  add column if not exists context public.shipment_context not null default 'cart_outbound';

alter table public.shipments
  alter column cart_id drop not null;

alter table public.shipments drop constraint if exists shipments_cart_context_check;
alter table public.shipments
  add constraint shipments_cart_context_check check (
    (context in ('cart_outbound', 'cart_return') and cart_id is not null)
    or (context not in ('cart_outbound', 'cart_return'))
  );

comment on column public.shipments.context is
  'Nature du colis : aller/retour panier (cart_id requis), ou flux intake/outtake membre (cart_id optionnel).';

-- 2) cart_items : statuts ligne pour contrôle / cycle (sans toucher items.status reserved)
-- Compare via status::text pour que ça reste valide si la colonne est déjà typée en enum
-- `cart_item_status` (bases où une migration ultérieure a été appliquée hors ordre).
alter table public.cart_items drop constraint if exists cart_items_status_check;
alter table public.cart_items add constraint cart_items_status_check check (
  status::text = any (
    array[
      'in_cart',
      'reserved',
      'archived',
      'reservation_pending',
      'verification_pending',
      'verified',
      'rejected',
      'needs_cleaning'
    ]::text[]
  )
);

comment on column public.cart_items.status is
  'Ligne panier : réservation (reserved/reservation_pending), cycle retour/contrôle (verification_pending, verified, rejected, needs_cleaning), archived.';

-- 3) Enum panier : remplace reserved -> checkout_pending, returned -> confirmed
do $body$
begin
  create type public.cart_status_new as enum (
    'active',
    'checkout_pending',
    'confirmed',
    'archived',
    'canceled'
  );
exception
  when duplicate_object then null;
end $body$;

alter table public.carts
  alter column status drop default;

alter table public.carts
  alter column status type public.cart_status_new
  using (
    case status::text
      when 'active' then 'active'::public.cart_status_new
      when 'reserved' then 'checkout_pending'::public.cart_status_new
      when 'returned' then 'confirmed'::public.cart_status_new
      when 'archived' then 'archived'::public.cart_status_new
      when 'canceled' then 'canceled'::public.cart_status_new
      else 'active'::public.cart_status_new
    end
  );

alter table public.carts
  alter column status set default 'active'::public.cart_status_new;

alter table public.cart_status_history
  alter column from_status type public.cart_status_new
  using (
    case
      when from_status is null then null::public.cart_status_new
      when from_status::text = 'active' then 'active'::public.cart_status_new
      when from_status::text = 'reserved' then 'checkout_pending'::public.cart_status_new
      when from_status::text = 'returned' then 'confirmed'::public.cart_status_new
      when from_status::text = 'archived' then 'archived'::public.cart_status_new
      when from_status::text = 'canceled' then 'canceled'::public.cart_status_new
      else null::public.cart_status_new
    end
  );

alter table public.cart_status_history
  alter column to_status type public.cart_status_new
  using (
    case to_status::text
      when 'active' then 'active'::public.cart_status_new
      when 'reserved' then 'checkout_pending'::public.cart_status_new
      when 'returned' then 'confirmed'::public.cart_status_new
      when 'archived' then 'archived'::public.cart_status_new
      when 'canceled' then 'canceled'::public.cart_status_new
      else 'active'::public.cart_status_new
    end
  );

drop type public.cart_status;

alter type public.cart_status_new rename to cart_status;

comment on type public.cart_status is
  'active=brouillon ; checkout_pending=réservation + page paiement (locked_until) ; confirmed=payé, logistique ; archived=cycle clos (lignes vérifiées) ; canceled=annulé.';

-- 4) wallet_holds (cascade : table peut déjà être absente sur certaines bases)
drop table if exists public.wallet_holds cascade;

-- 5) Concurrence paniers
create or replace function public.get_cart_items_competition_state(p_item_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with uid as (
    select auth.uid() as viewer_id
  ),
  ids as (
    select distinct x as item_id
    from unnest(coalesce(p_item_ids, array[]::uuid[])) as t(x)
    where x is not null
  ),
  agg as (
    select
      i.item_id,
      (
        select count(*)::int
        from public.cart_items ci
        join public.carts c on c.id = ci.cart_id
        cross join uid u
        where ci.item_id = i.item_id
          and ci.deleted_at is null
          and ci.status = 'in_cart'
          and c.deleted_at is null
          and c.user_id is distinct from u.viewer_id
          and c.status in ('active'::public.cart_status, 'checkout_pending'::public.cart_status)
      ) as other_shoppers_in_cart,
      coalesce(
        (
          select
            (coalesce(it.status::text, '') = 'reserved'
             and not exists (
               select 1
               from public.cart_items ci2
               join public.carts c2 on c2.id = ci2.cart_id
               cross join uid u2
               where ci2.item_id = i.item_id
                 and ci2.deleted_at is null
                 and ci2.status = 'reserved'
                 and c2.user_id = u2.viewer_id
             ))
          from public.items it
          where it.id = i.item_id
            and it.deleted_at is null
        ),
        false
      ) as reserved_by_other,
      (
        select max(sub.t)
        from (
          select c.locked_until as t
          from public.cart_items ci
          join public.carts c on c.id = ci.cart_id
          cross join uid u
          where ci.item_id = i.item_id
            and ci.deleted_at is null
            and ci.status = 'reserved'
            and c.deleted_at is null
            and c.user_id is distinct from u.viewer_id
            and c.status = 'checkout_pending'::public.cart_status
            and c.locked_until is not null
        ) sub
        where sub.t is not null
      ) as reserved_until_at
    from ids i
    cross join uid u0
    where u0.viewer_id is not null
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'item_id', a.item_id,
          'other_shoppers_in_cart', a.other_shoppers_in_cart,
          'reserved_by_other', a.reserved_by_other,
          'reserved_until_at', a.reserved_until_at
        )
        order by a.item_id
      )
      from agg a
    ),
    '[]'::jsonb
  );
$fn$;

revoke all on function public.get_cart_items_competition_state(uuid[]) from public;
grant execute on function public.get_cart_items_competition_state(uuid[]) to authenticated;

-- 6) Réservation panier sans hold (locked_until + checkout_pending) — pas de gate sur le wallet
create or replace function public.reserve_cart_atomic(
  p_cart_id uuid,
  p_lock_ttl_seconds integer default 600,
  p_hold_ttl_minutes integer default 10,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $reserve$
declare
  v_uid uuid;
  v_cart_owner uuid;
  v_cart_status public.cart_status;
  v_item_count integer;
  v_ready_count integer;
  v_total_points bigint;
  v_available bigint;
  v_shortfall bigint;
  v_reserved_ids uuid[];
  v_reserved_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_lock_ttl_seconds is null or p_lock_ttl_seconds <= 0 then
    raise exception 'p_lock_ttl_seconds must be > 0';
  end if;

  select c.user_id, c.status
    into v_cart_owner, v_cart_status
  from public.carts c
  where c.id = p_cart_id
  for update;

  if not found then
    raise exception 'Cart not found';
  end if;

  if v_cart_owner <> v_uid then
    raise exception 'Forbidden: cart does not belong to current user';
  end if;

  if v_cart_status = 'checkout_pending' then
    if exists (
      select 1
      from public.carts c2
      where c2.id = p_cart_id
        and c2.locked_until is not null
        and c2.locked_until > now()
    ) then
      return jsonb_build_object(
        'ok', true,
        'already_reserved', true,
        'cart_id', p_cart_id
      );
    end if;
  end if;

  if v_cart_status is distinct from 'active' then
    raise exception 'Cart is not reservable in current status: %', v_cart_status;
  end if;

  perform 1
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
  for update;

  perform 1
  from public.items i
  join public.cart_items ci on ci.item_id = i.id
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
  for update;

  select count(*)::int
    into v_item_count
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  if v_item_count = 0 then
    raise exception 'Cart is empty';
  end if;

  select coalesce(
    array_agg(ci.id order by coalesce(i.price_points, 0) asc, ci.created_at asc, ci.id asc),
    '{}'::uuid[]
  )
    into v_reserved_ids
  from public.cart_items ci
  join public.items i on i.id = ci.item_id
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  v_reserved_count := coalesce(array_length(v_reserved_ids, 1), 0);

  v_available := public.wallet_available_points(v_uid);

  select coalesce(sum(coalesce(i.price_points, 0)), 0)::bigint
    into v_total_points
  from public.cart_items ci
  join public.items i on i.id = ci.item_id
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  v_shortfall := greatest(0::bigint, v_total_points - v_available);

  if exists (
    select 1
    from public.cart_items ci
    join public.items i on i.id = ci.item_id
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.id = any (v_reserved_ids)
      and i.deleted_at is null
      and i.status = 'reserved'::public.item_status
  ) then
    raise exception 'ITEM_RESERVED_BY_ANOTHER_MEMBER';
  end if;

  select count(*)::int
    into v_ready_count
  from public.cart_items ci
  join public.item_inventory_locks l
    on l.item_id = ci.item_id
   and l.cart_id = p_cart_id
   and l.locked_by_user_id = v_uid
   and l.expires_at > now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.id = any (v_reserved_ids);

  if exists (
    select 1
    from public.item_inventory_locks il
    where il.cart_id = p_cart_id
      and il.locked_by_user_id = v_uid
  ) then
    if v_ready_count <> v_reserved_count then
      raise exception 'Missing or expired item locks for some reserved cart items';
    end if;
  end if;

  delete from public.item_inventory_locks il
  where il.cart_id = p_cart_id
    and il.locked_by_user_id = v_uid
    and il.item_id in (
      select ci.item_id
      from public.cart_items ci
      where ci.cart_id = p_cart_id
        and ci.deleted_at is null
        and not (ci.id = any (v_reserved_ids))
    );

  update public.items i
  set
    status = case
      when ci.id = any (v_reserved_ids) then 'reserved'::public.item_status
      else 'available'::public.item_status
    end,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id;

  update public.cart_items ci
  set
    status = 'reserved',
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  update public.carts
  set
    status = 'checkout_pending',
    locked_until = now() + make_interval(secs => p_lock_ttl_seconds),
    updated_at = now()
  where id = p_cart_id;

  update public.item_inventory_locks il
  set expires_at = now() + make_interval(secs => p_lock_ttl_seconds)
  where il.cart_id = p_cart_id
    and il.locked_by_user_id = v_uid
    and il.item_id in (
      select ci.item_id
      from public.cart_items ci
      where ci.cart_id = p_cart_id
        and ci.deleted_at is null
        and ci.id = any (v_reserved_ids)
    );

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, v_cart_status, 'checkout_pending', 'reserve_cart_atomic_checkout_no_wallet_gate', v_uid);

  perform public.log_activity_event(
    'cart_checkout_pending',
    jsonb_build_object(
      'cart_id', p_cart_id,
      'item_count', v_item_count,
      'reserved_line_count', v_reserved_count,
      'amount_points', v_total_points,
      'wallet_available_points', v_available,
      'shortfall_points', v_shortfall,
      'lock_ttl_seconds', p_lock_ttl_seconds
    ),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'item_count', v_item_count,
    'reserved_line_count', v_reserved_count,
    'pending_line_count', 0,
    'amount_points', v_total_points,
    'wallet_available_points', v_available,
    'shortfall_points', v_shortfall
  );
end;
$reserve$;

-- 7) Expiration checkout (plus de holds)
create or replace function public.expire_wallet_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $expire$
declare
  v_count integer := 0;
  v_cart record;
begin
  for v_cart in
    select c.id, c.user_id
    from public.carts c
    where c.status = 'checkout_pending'::public.cart_status
      and c.locked_until is not null
      and c.locked_until <= now()
    for update
  loop
    update public.items i
    set
      status = 'in_cart'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = v_cart.id
      and ci.deleted_at is null
      and ci.item_id = i.id;

    update public.cart_items
    set
      status = 'in_cart',
      updated_at = now()
    where cart_id = v_cart.id
      and deleted_at is null
      and status in ('reserved', 'reservation_pending');

    update public.carts
    set
      status = 'active',
      locked_until = null,
      updated_at = now()
    where id = v_cart.id;

    insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
    values (v_cart.id, 'checkout_pending', 'active', 'checkout_lock_expired', null);

    perform public.log_activity_event(
      'checkout_lock_expired',
      jsonb_build_object('cart_id', v_cart.id),
      null
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$expire$;

-- 8) Sortie page paiement sans hold
create or replace function public.release_wallet_hold(
  p_cart_id uuid,
  p_idempotency_key text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $release$
declare
  v_uid uuid;
  v_cart_owner uuid;
  v_reason text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select c.user_id
    into v_cart_owner
  from public.carts c
  where c.id = p_cart_id;

  if not found then
    raise exception 'Cart not found';
  end if;

  if v_cart_owner is distinct from v_uid then
    raise exception 'Forbidden: cart does not belong to current user';
  end if;

  if not exists (
    select 1 from public.carts c where c.id = p_cart_id and c.status = 'checkout_pending'::public.cart_status
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_checkout_pending');
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'payment_page_exit');

  update public.items i
  set
    status = 'in_cart'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id;

  update public.cart_items
  set
    status = 'in_cart',
    updated_at = now()
  where cart_id = p_cart_id
    and deleted_at is null
    and status in ('reserved', 'reservation_pending');

  update public.carts
  set
    status = 'active',
    locked_until = null,
    updated_at = now()
  where id = p_cart_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, 'checkout_pending', 'active', 'checkout_abandoned_client', v_uid);

  perform public.log_activity_event(
    'checkout_abandoned',
    jsonb_build_object(
      'cart_id', p_cart_id,
      'release_reason', v_reason
    ),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id
  );
end;
$release$;

grant execute on function public.release_wallet_hold(uuid, text, text) to authenticated;

-- 9) Soft-delete ligne : panier confirmed garde aussi items reserved
create or replace function public.trg_cart_items_recompute_item_status_on_soft_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_item_id uuid;
  v_next_status public.item_status;
begin
  v_item_id := old.item_id;
  if v_item_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
      and ci.status = 'reserved'
  ) then
    v_next_status := 'reserved'::public.item_status;
  elsif exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('active'::public.cart_status, 'checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
  ) then
    v_next_status := 'in_cart'::public.item_status;
  else
    v_next_status := 'available'::public.item_status;
  end if;

  update public.items i
  set
    status = v_next_status,
    updated_at = now()
  where i.id = v_item_id
    and i.status is distinct from v_next_status;

  return new;
end;
$$;

-- 10) Capacité wallet : plus de soustraction des holds (table supprimée).
create or replace function public.wallet_available_points(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select w.balance_points from public.user_wallets w where w.user_id = p_user_id and w.deleted_at is null),
    0::bigint
  );
$function$;
