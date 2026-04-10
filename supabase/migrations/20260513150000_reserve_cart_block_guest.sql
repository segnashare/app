-- Invités (sans abonnement actif ni rôle membre) : pas de réservation d’inventaire (pas de passage en checkout_pending via reserve_cart_atomic).
-- Aligné sur resolveMembershipLabel côté app (abonnement Stripe actif / rôles membre).

create or replace function public.user_can_reserve_cart_inventory(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    exists (
      select 1
      from public.user_subscriptions s
      where s.user_id = p_user_id
        and s.provider = 'stripe'
        and lower(coalesce(s.status, '')) in ('active', 'trialing')
        and lower(coalesce(s.plan_code, '')) in ('segna_plus', 'segna_x')
    )
    or exists (
      select 1
      from public.user_roles ur
      where ur.user_id = p_user_id
        and (
          lower(coalesce(ur.role::text, '')) like '%segna_x%'
          or lower(coalesce(ur.role::text, '')) like '%membre_x%'
          or lower(coalesce(ur.role::text, '')) like '%member_x%'
          or lower(coalesce(ur.role::text, '')) like '%premium%'
          or lower(coalesce(ur.role::text, '')) like '%segna_plus%'
          or lower(coalesce(ur.role::text, '')) like '%membre_plus%'
          or lower(coalesce(ur.role::text, '')) like '%member_plus%'
          or (
            position('plus' in lower(coalesce(ur.role::text, ''))) > 0
            and lower(coalesce(ur.role::text, '')) not like '%prospect%'
          )
        )
    );
$$;

comment on function public.user_can_reserve_cart_inventory(uuid) is
  'True si l’utilisateur peut verrouiller l’inventaire (Membre + / X), false pour invité.';

revoke all on function public.user_can_reserve_cart_inventory(uuid) from public;
grant execute on function public.user_can_reserve_cart_inventory(uuid) to authenticated;

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

  if not public.user_can_reserve_cart_inventory(v_uid) then
    raise exception 'GUEST_RESERVATION_NOT_ALLOWED';
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
