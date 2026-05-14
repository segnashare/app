-- Retrait de l’usage de `listed` sur public.item_status : les pièces catalogue
-- utilisables au panier sont `available` ; annulation panier / RPC / catalogue alignés.
-- Backfill + recréation des fonctions qui référençaient encore `listed`.
-- (La valeur enum peut rester dans le type tant que PostgreSQL ne permet pas DROP VALUE
--  sur votre version ; elle n’est plus assignée ni filtrée côté SQL applicatif.)

update public.items
set
  status = 'available'::public.item_status,
  updated_at = now()
where deleted_at is null
  and status = 'listed'::public.item_status;


-- === patched from 20260816090000_cancel_cart_revert_orders_used_guest.sql ===

-- Annulation panier : libérer le quota mensuel pour tous les profils (invité inclus),
-- pas seulement Segna+ / X actifs. Supprime la ligne bump idempotente pour ce panier.

create or replace function public.member_cancel_cart_order_pending_preparation(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_cart_status public.cart_status;
  v_ship_id uuid;
  v_ship_status public.shipment_status;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_debit_anchor_id uuid;
  v_sum_debits bigint;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_cart_id is null then
    raise exception 'cart_id is required';
  end if;

  select c.user_id, c.status
    into v_owner, v_cart_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'CART_NOT_FOUND';
  end if;

  if v_owner is distinct from v_uid then
    raise exception 'FORBIDDEN';
  end if;

  if v_cart_status = 'canceled'::public.cart_status then
    return jsonb_build_object('ok', true, 'already_canceled', true, 'cart_id', p_cart_id);
  end if;

  if v_cart_status is distinct from 'confirmed'::public.cart_status then
    raise exception 'CART_NOT_CANCELLABLE_STATUS:%', v_cart_status;
  end if;

  select s.id, s.status
    into v_ship_id, v_ship_status
  from public.shipments s
  where s.cart_id = p_cart_id
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;

  if v_ship_id is null then
    raise exception 'OUTBOUND_SHIPMENT_NOT_FOUND';
  end if;

  if v_ship_status not in (
    'pending'::public.shipment_status,
    'ready'::public.shipment_status
  ) then
    raise exception 'SHIPMENT_NOT_PENDING:%', v_ship_status;
  end if;

  select
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'consumption' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    (array_agg(wt.id order by wt.id desc))[1],
    coalesce(sum(wt.amount_points), 0::bigint)
  into v_ex, v_co, v_debit_anchor_id, v_sum_debits
  from public.wallet_transactions wt
  where wt.user_id = v_uid
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = p_cart_id;

  if v_debit_anchor_id is null or (v_ex <= 0 and v_co <= 0) then
    raise exception 'CART_DEBIT_NOT_FOUND';
  end if;

  if v_sum_debits <> v_ex + v_co then
    raise exception 'CART_DEBIT_SPLIT_MISMATCH';
  end if;

  if not public.user_can_reserve_cart_inventory(v_uid) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  v_key_ex := format('cart_order_cancel_refund_ex:%s', p_cart_id);
  v_key_co := format('cart_order_cancel_refund_co:%s', p_cart_id);

  if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_ex,
      'posted',
      v_key_ex,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'exchange'
      ),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_co,
      'posted',
      v_key_co,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'consumption'
      ),
      'consumption'
    );
    v_did_co := true;
  end if;

  if v_did_ex or v_did_co then
    update public.user_wallets uw
    set
      balance_exchange_points = case
        when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex
        else uw.balance_exchange_points
      end,
      balance_consumption_points = case
        when v_did_co then uw.balance_consumption_points + v_co
        else uw.balance_consumption_points
      end,
      updated_at = now()
    where uw.id = (
      select id from public.user_wallets
      where user_id = v_uid and deleted_at is null
      order by updated_at desc
      limit 1
    )
    returning uw.id into v_wallet_id;

    if v_wallet_id is null then
      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (
        v_uid,
        case when v_did_co then v_co else 0 end,
        case when v_did_ex then v_ex else null end
      )
      returning id into v_wallet_id;
    end if;
  end if;

  update public.items i
  set
    status = 'available'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and i.status = 'reserved'::public.item_status;

  update public.cart_items ci
  set
    status = 'archived'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  update public.shipments s
  set
    status = 'closed'::public.shipment_status,
    updated_at = now()
  where s.id = v_ship_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    'confirmed'::public.cart_status,
    'canceled'::public.cart_status,
    'member_cancel_pending_preparation',
    v_uid
  );

  update public.carts c
  set
    status = 'canceled'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  delete from public.cart_monthly_orders_used_bumps b
  where b.cart_id = p_cart_id
    and b.user_id = v_uid;

  update public.user_monthly_entitlements e
  set
    orders_used = greatest(0, e.orders_used - 1),
    updated_at = now()
  where e.user_id = v_uid
    and e.period_month = v_period_month
    and e.orders_used > 0;

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'refunded_exchange_points', v_ex,
    'refunded_consumption_points', v_co
  );
end;
$fn$;

comment on function public.member_cancel_cart_order_pending_preparation(uuid) is
  'Membre : annule une commande confirmée tant que l’expédition aller est pending ou ready. Rembourse crédits (débits panier agrégés), items → available, panier canceled. '
  'Décrémente orders_used (invité ou abonné) et retire la ligne bump panier. Remboursement € Stripe : route API avant appel.';

create or replace function public.backoffice_cancel_cart_order_pending_preparation(
  p_cart_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_owner uuid;
  v_cart_status public.cart_status;
  v_ship_id uuid;
  v_ship_status public.shipment_status;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_debit_anchor_id uuid;
  v_sum_debits bigint;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'FORBIDDEN_NOT_SERVICE_ROLE';
  end if;

  if p_cart_id is null then
    raise exception 'cart_id is required';
  end if;

  select c.user_id, c.status
    into v_owner, v_cart_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'CART_NOT_FOUND';
  end if;

  if v_cart_status = 'canceled'::public.cart_status then
    return jsonb_build_object('ok', true, 'already_canceled', true, 'cart_id', p_cart_id);
  end if;

  if v_cart_status is distinct from 'confirmed'::public.cart_status then
    raise exception 'CART_NOT_CANCELLABLE_STATUS:%', v_cart_status;
  end if;

  select s.id, s.status
    into v_ship_id, v_ship_status
  from public.shipments s
  where s.cart_id = p_cart_id
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;

  if v_ship_id is null then
    raise exception 'OUTBOUND_SHIPMENT_NOT_FOUND';
  end if;

  if v_ship_status is distinct from 'pending'::public.shipment_status then
    raise exception 'SHIPMENT_NOT_PENDING:%', v_ship_status;
  end if;

  select
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'consumption' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    (array_agg(wt.id order by wt.id desc))[1],
    coalesce(sum(wt.amount_points), 0::bigint)
  into v_ex, v_co, v_debit_anchor_id, v_sum_debits
  from public.wallet_transactions wt
  where wt.user_id = v_owner
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = p_cart_id;

  if v_debit_anchor_id is null or (v_ex <= 0 and v_co <= 0) then
    raise exception 'CART_DEBIT_NOT_FOUND';
  end if;

  if v_sum_debits <> v_ex + v_co then
    raise exception 'CART_DEBIT_SPLIT_MISMATCH';
  end if;

  if not public.user_can_reserve_cart_inventory(v_owner) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  v_key_ex := format('cart_order_cancel_refund_ex:%s', p_cart_id);
  v_key_co := format('cart_order_cancel_refund_co:%s', p_cart_id);

  if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_owner,
      'credit',
      'credit',
      v_ex,
      'posted',
      v_key_ex,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'exchange'
      ),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_owner,
      'credit',
      'credit',
      v_co,
      'posted',
      v_key_co,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'consumption'
      ),
      'consumption'
    );
    v_did_co := true;
  end if;

  if v_did_ex or v_did_co then
    update public.user_wallets uw
    set
      balance_exchange_points = case
        when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex
        else uw.balance_exchange_points
      end,
      balance_consumption_points = case
        when v_did_co then uw.balance_consumption_points + v_co
        else uw.balance_consumption_points
      end,
      updated_at = now()
    where uw.id = (
      select id from public.user_wallets
      where user_id = v_owner and deleted_at is null
      order by updated_at desc
      limit 1
    )
    returning uw.id into v_wallet_id;

    if v_wallet_id is null then
      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (
        v_owner,
        case when v_did_co then v_co else 0 end,
        case when v_did_ex then v_ex else null end
      )
      returning id into v_wallet_id;
    end if;
  end if;

  update public.items i
  set
    status = 'available'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and i.status = 'reserved'::public.item_status;

  update public.cart_items ci
  set
    status = 'archived'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  update public.shipments s
  set
    status = 'closed'::public.shipment_status,
    updated_at = now()
  where s.id = v_ship_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    'confirmed'::public.cart_status,
    'canceled'::public.cart_status,
    'backoffice_cancel_pending_preparation',
    p_actor_user_id
  );

  update public.carts c
  set
    status = 'canceled'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  delete from public.cart_monthly_orders_used_bumps b
  where b.cart_id = p_cart_id
    and b.user_id = v_owner;

  update public.user_monthly_entitlements e
  set
    orders_used = greatest(0, e.orders_used - 1),
    updated_at = now()
  where e.user_id = v_owner
    and e.period_month = v_period_month
    and e.orders_used > 0;

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'refunded_exchange_points', v_ex,
    'refunded_consumption_points', v_co
  );
end;
$fn$;

comment on function public.backoffice_cancel_cart_order_pending_preparation(uuid, uuid) is
  $cmt$Back-office (service_role) : annule une commande confirmée tant que l'expédition aller est pending. Décrémente orders_used (invité ou abonné) et retire la ligne bump panier. Remboursement € Stripe : route API segna-app avant appel.$cmt$;

revoke all on function public.member_cancel_cart_order_pending_preparation(uuid) from public;
grant execute on function public.member_cancel_cart_order_pending_preparation(uuid) to authenticated;

revoke all on function public.backoffice_cancel_cart_order_pending_preparation(uuid, uuid) from public;
grant execute on function public.backoffice_cancel_cart_order_pending_preparation(uuid, uuid) to service_role;


-- === patched from 20260530120000_marketing_catalog_items_page_category_ids.sql ===

-- Filtre catalogue marketing par plusieurs catégories (sous-arbre parent).

drop function if exists public.get_marketing_website_catalog_items_page(
  integer,
  integer,
  text,
  uuid,
  uuid[],
  uuid[],
  uuid[]
);

create or replace function public.get_marketing_website_catalog_items_page(
  p_limit integer default 50,
  p_offset integer default 0,
  p_sort text default 'recent',
  p_category_id uuid default null,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_couleur_ids uuid[] default null,
  p_size_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_total bigint;
  v_limit integer;
  v_offset integer;
  v_sort text;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_sort := lower(trim(coalesce(p_sort, 'recent')));

  select count(*)::bigint
  into v_total
  from public.items i
  where i.deleted_at is null
    and i.status in (
            'available'::public.item_status,
      'in_cart'::public.item_status,
      'reserved'::public.item_status
    )
    and not exists (
      select 1
      from public.users u
      where u.id = i.owner_user_id
        and u.status = 'corporate_inventory'::public.user_status
    )
    and (
      case
        when p_category_ids is not null and cardinality(p_category_ids) > 0 then
          i.item_category_id = any(p_category_ids)
        when p_category_id is not null then
          i.item_category_id = p_category_id
        else true
      end
    )
    and (
      p_brand_ids is null
      or cardinality(p_brand_ids) = 0
      or i.item_brand_id = any(p_brand_ids)
    )
    and (
      p_couleur_ids is null
      or cardinality(p_couleur_ids) = 0
      or i.item_couleur_id = any(p_couleur_ids)
    )
    and (
      p_size_ids is null
      or cardinality(p_size_ids) = 0
      or i.item_size_id = any(p_size_ids)
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'description', s.description,
        'price_points', s.price_points,
        'status', s.status,
        'photos', s.photos,
        'item_category_id', s.item_category_id,
        'item_size_id', s.item_size_id,
        'item_brand_id', s.item_brand_id,
        'item_couleur_id', s.item_couleur_id,
        'item_materiaux_id', s.item_materiaux_id,
        'category_label', s.category_label,
        'size_label', s.size_label,
        'materials_label', s.materials_label,
        'color_label', s.color_label,
        'brand_label', s.brand_label,
        'condition_label', s.condition_label,
        'condition_score', s.condition_score
      )
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      i.id,
      i.title,
      i.description,
      i.price_points,
      i.status::text as status,
      i.photos,
      i.item_category_id,
      i.item_size_id,
      i.item_brand_id,
      i.item_couleur_id,
      i.item_materiaux_id,
      i.updated_at as sort_key,
      cat.name as category_label,
      sz.label as size_label,
      mat.label as materials_label,
      col.label as color_label,
      coalesce(
        nullif(trim(i.item_custom_brand_label), ''),
        case when br.slug = 'autre' then left(nullif(trim(i.title), ''), 30) else null end,
        br.label
      ) as brand_label,
      (
        select case ich.condition_score
          when 'neuf_etiquette' then 'Neuf avec etiquette'
          when 'excellent' then 'Excellent etat'
          when 'tres_bon' then 'Tres bon etat'
          when 'bon' then 'Bon etat'
          when 'acceptable' then 'Acceptable'
          when 'degrade' then 'Degrade'
          else ich.condition_score::text
        end
        from public.item_condition_history ich
        where ich.item_id = i.id
          and ich.status = 'confirmed'
        order by ich.created_at desc
        limit 1
      ) as condition_label,
      (
        select ich.condition_score::text
        from public.item_condition_history ich
        where ich.item_id = i.id
          and ich.status = 'confirmed'
        order by ich.created_at desc
        limit 1
      ) as condition_score
    from public.items i
    left join public.item_categories cat on cat.id = i.item_category_id
    left join public.sizes sz on sz.id = i.item_size_id
    left join public.item_materiaux mat on mat.id = i.item_materiaux_id
    left join public.item_couleurs col on col.id = i.item_couleur_id
    left join public.item_brands br on br.id = i.item_brand_id
    where i.deleted_at is null
      and i.status in (
                'available'::public.item_status,
        'in_cart'::public.item_status,
        'reserved'::public.item_status
      )
      and not exists (
        select 1
        from public.users u
        where u.id = i.owner_user_id
          and u.status = 'corporate_inventory'::public.user_status
      )
      and (
        case
          when p_category_ids is not null and cardinality(p_category_ids) > 0 then
            i.item_category_id = any(p_category_ids)
          when p_category_id is not null then
            i.item_category_id = p_category_id
          else true
        end
      )
      and (
        p_brand_ids is null
        or cardinality(p_brand_ids) = 0
        or i.item_brand_id = any(p_brand_ids)
      )
      and (
        p_couleur_ids is null
        or cardinality(p_couleur_ids) = 0
        or i.item_couleur_id = any(p_couleur_ids)
      )
      and (
        p_size_ids is null
        or cardinality(p_size_ids) = 0
        or i.item_size_id = any(p_size_ids)
      )
    order by
      case when v_sort = 'price_asc' then i.price_points end asc nulls last,
      case when v_sort = 'price_desc' then i.price_points end desc nulls last,
      i.updated_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0)
  );
end;
$$;

comment on function public.get_marketing_website_catalog_items_page(
  integer,
  integer,
  text,
  uuid,
  uuid[],
  uuid[],
  uuid[],
  uuid[]
) is
  'Catalogue marketing paginé + filtres + tri. service_role.';

revoke all on function public.get_marketing_website_catalog_items_page(
  integer,
  integer,
  text,
  uuid,
  uuid[],
  uuid[],
  uuid[],
  uuid[]
) from public;
revoke all on function public.get_marketing_website_catalog_items_page(
  integer,
  integer,
  text,
  uuid,
  uuid[],
  uuid[],
  uuid[],
  uuid[]
) from anon;
revoke all on function public.get_marketing_website_catalog_items_page(
  integer,
  integer,
  text,
  uuid,
  uuid[],
  uuid[],
  uuid[],
  uuid[]
) from authenticated;
grant execute on function public.get_marketing_website_catalog_items_page(
  integer,
  integer,
  text,
  uuid,
  uuid[],
  uuid[],
  uuid[],
  uuid[]
) to service_role;


-- === patched from 20260531140000_marketing_catalog_facets_scoped.sql ===

-- Facettes catalogue marketing filtrées (chaque dimension exclut son propre filtre pour n’afficher que des options encore pertinentes).

create or replace function public.get_marketing_website_catalog_facets_scoped(
  p_brand_ids uuid[] default null,
  p_category_id uuid default null,
