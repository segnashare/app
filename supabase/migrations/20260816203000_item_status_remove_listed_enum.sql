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
  p_category_ids uuid[] default null,
  p_color_ids uuid[] default null,
  p_size_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select
      i.id,
      i.item_category_id,
      cat.name as category_label,
      i.item_brand_id,
      coalesce(
        nullif(trim(i.item_custom_brand_label), ''),
        case when br.slug = 'autre' then left(nullif(trim(i.title), ''), 30) else null end,
        br.label
      ) as brand_label,
      i.item_couleur_id,
      col.label as color_label,
      i.item_size_id,
      sz.label as size_label
    from public.items i
    left join public.item_categories cat on cat.id = i.item_category_id
    left join public.item_brands br on br.id = i.item_brand_id
    left join public.item_couleurs col on col.id = i.item_couleur_id
    left join public.sizes sz on sz.id = i.item_size_id
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
  ),
  for_categories as (
    select e.*
    from eligible e
    where
      (p_brand_ids is null or cardinality(p_brand_ids) = 0 or e.item_brand_id = any(p_brand_ids))
      and (
        p_color_ids is null
        or cardinality(p_color_ids) = 0
        or e.item_couleur_id = any(p_color_ids)
      )
      and (
        p_size_ids is null
        or cardinality(p_size_ids) = 0
        or e.item_size_id = any(p_size_ids)
      )
  ),
  for_brands as (
    select e.*
    from eligible e
    where
      (
        case
          when p_category_ids is not null and cardinality(p_category_ids) > 0 then
            e.item_category_id = any(p_category_ids)
          when p_category_id is not null then
            e.item_category_id = p_category_id
          else true
        end
      )
      and (
        p_color_ids is null
        or cardinality(p_color_ids) = 0
        or e.item_couleur_id = any(p_color_ids)
      )
      and (
        p_size_ids is null
        or cardinality(p_size_ids) = 0
        or e.item_size_id = any(p_size_ids)
      )
  ),
  for_colors as (
    select e.*
    from eligible e
    where
      (p_brand_ids is null or cardinality(p_brand_ids) = 0 or e.item_brand_id = any(p_brand_ids))
      and (
        case
          when p_category_ids is not null and cardinality(p_category_ids) > 0 then
            e.item_category_id = any(p_category_ids)
          when p_category_id is not null then
            e.item_category_id = p_category_id
          else true
        end
      )
      and (
        p_size_ids is null
        or cardinality(p_size_ids) = 0
        or e.item_size_id = any(p_size_ids)
      )
  ),
  for_sizes as (
    select e.*
    from eligible e
    where
      (p_brand_ids is null or cardinality(p_brand_ids) = 0 or e.item_brand_id = any(p_brand_ids))
      and (
        case
          when p_category_ids is not null and cardinality(p_category_ids) > 0 then
            e.item_category_id = any(p_category_ids)
          when p_category_id is not null then
            e.item_category_id = p_category_id
          else true
        end
      )
      and (
        p_color_ids is null
        or cardinality(p_color_ids) = 0
        or e.item_couleur_id = any(p_color_ids)
      )
  )
  select jsonb_build_object(
    'categories',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_category_id, 'label', b.category_label) as obj
          from for_categories b
          where b.item_category_id is not null and nullif(trim(b.category_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    ),
    'brands',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_brand_id, 'label', b.brand_label) as obj
          from for_brands b
          where b.item_brand_id is not null and nullif(trim(b.brand_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    ),
    'colors',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_couleur_id, 'label', b.color_label) as obj
          from for_colors b
          where b.item_couleur_id is not null and nullif(trim(b.color_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    ),
    'sizes',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_size_id, 'label', b.size_label) as obj
          from for_sizes b
          where b.item_size_id is not null and nullif(trim(b.size_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.get_marketing_website_catalog_facets_scoped(
  uuid[],
  uuid,
  uuid[],
  uuid[],
  uuid[]
) is
  'Facettes catalogue filtrées (exclusion par dimension). service_role.';

revoke all on function public.get_marketing_website_catalog_facets_scoped(
  uuid[],
  uuid,
  uuid[],
  uuid[],
  uuid[]
) from public;
revoke all on function public.get_marketing_website_catalog_facets_scoped(
  uuid[],
  uuid,
  uuid[],
  uuid[],
  uuid[]
) from anon;
revoke all on function public.get_marketing_website_catalog_facets_scoped(
  uuid[],
  uuid,
  uuid[],
  uuid[],
  uuid[]
) from authenticated;
grant execute on function public.get_marketing_website_catalog_facets_scoped(
  uuid[],
  uuid,
  uuid[],
  uuid[],
  uuid[]
) to service_role;


-- === patched from 20260529120000_marketing_website_catalog_facets.sql ===

-- Facettes catalogue marketing (options de filtres sur tout le périmètre éligible).

create or replace function public.get_marketing_website_catalog_facets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      i.id,
      i.item_category_id,
      cat.name as category_label,
      i.item_brand_id,
      coalesce(
        nullif(trim(i.item_custom_brand_label), ''),
        case when br.slug = 'autre' then left(nullif(trim(i.title), ''), 30) else null end,
        br.label
      ) as brand_label,
      i.item_couleur_id,
      col.label as color_label,
      i.item_size_id,
      sz.label as size_label
    from public.items i
    left join public.item_categories cat on cat.id = i.item_category_id
    left join public.item_brands br on br.id = i.item_brand_id
    left join public.item_couleurs col on col.id = i.item_couleur_id
    left join public.sizes sz on sz.id = i.item_size_id
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
  )
  select jsonb_build_object(
    'categories',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_category_id, 'label', b.category_label) as obj
          from base b
          where b.item_category_id is not null and nullif(trim(b.category_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    ),
    'brands',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_brand_id, 'label', b.brand_label) as obj
          from base b
          where b.item_brand_id is not null and nullif(trim(b.brand_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    ),
    'colors',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_couleur_id, 'label', b.color_label) as obj
          from base b
          where b.item_couleur_id is not null and nullif(trim(b.color_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    ),
    'sizes',
    coalesce(
      (
        select jsonb_agg(x.obj order by (x.obj->>'label'))
        from (
          select distinct jsonb_build_object('id', b.item_size_id, 'label', b.size_label) as obj
          from base b
          where b.item_size_id is not null and nullif(trim(b.size_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.get_marketing_website_catalog_facets() is
  'Facettes (catégories, marques, couleurs, tailles) pour le catalogue marketing. service_role.';

revoke all on function public.get_marketing_website_catalog_facets() from public;
revoke all on function public.get_marketing_website_catalog_facets() from anon;
revoke all on function public.get_marketing_website_catalog_facets() from authenticated;
grant execute on function public.get_marketing_website_catalog_facets() to service_role;


-- === patched from 20260529110000_marketing_website_catalog_items_list.sql ===

-- Liste catalogue marketing (site web), sans liste d’UUID — même charge utile que get_marketing_website_catalog_items_by_ids.

create or replace function public.get_marketing_website_catalog_items(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_limit integer;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 200), 500));

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
      order by s.sort_key desc
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
    order by i.updated_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_marketing_website_catalog_items(integer) is
  'Liste catalogue site marketing (tri date décroissante). Rôle service_role uniquement.';

revoke all on function public.get_marketing_website_catalog_items(integer) from public;
revoke all on function public.get_marketing_website_catalog_items(integer) from anon;
revoke all on function public.get_marketing_website_catalog_items(integer) from authenticated;
grant execute on function public.get_marketing_website_catalog_items(integer) to service_role;


-- === patched from 20260529100000_marketing_website_catalog_items_by_ids.sql ===

-- Catalogue marketing (site web) : lecture par UUID sans session membre.
-- Réservé au service_role (clé serveur Next.js) — pas d’exécution anon.

create or replace function public.get_marketing_website_catalog_items_by_ids(p_item_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

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
      order by s.ord
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
      array_position(p_item_ids, i.id) as ord,
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
    where i.id = any(p_item_ids)
      and i.deleted_at is null
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
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_marketing_website_catalog_items_by_ids(uuid[]) is
  'Pièces catalogue pour le site marketing (UUID, ordre conservé). Rôle service_role uniquement.';

revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from public;
revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from anon;
revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from authenticated;
grant execute on function public.get_marketing_website_catalog_items_by_ids(uuid[]) to service_role;


-- === patched from 20260503110000_shop_featured_lenders_email_and_segna_display.sql ===

-- Compte « Segna S. » sans email @segnashare.com : rôle organization explicite.
insert into public.user_roles (user_id, role)
select up.user_id, 'organization'::public.app_role
from public.user_profiles up
inner join public.users u on u.id = up.user_id
where u.deleted_at is null
  and up.deleted_at is null
  and trim(coalesce(up.display_name, '')) = 'Segna S.'
on conflict (user_id, role) do update
set
  deleted_at = null,
  updated_at = now();

-- Exclure les emails @segnashare.com sans laisser passer email NULL (bug précédent).
create or replace function public.get_shop_featured_lenders(p_limit integer default 9)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 9), 24));

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'user_id', x.user_id,
          'display_name', up.display_name,
          'city', up.city,
          'item_count', x.cnt,
          'photos', up.photos
        )
        order by x.cnt desc, x.last_item_at desc nulls last
      )
      from (
        select
          i.owner_user_id as user_id,
          count(*)::integer as cnt,
          max(i.updated_at) as last_item_at
        from public.items i
        inner join public.users u on u.id = i.owner_user_id
        where i.deleted_at is null
          and i.owner_user_id is distinct from v_uid
          and u.status is distinct from 'corporate_inventory'::public.user_status
          and not (
            u.email is not null
            and lower(u.email) like '%@segnashare.com'
          )
          and not exists (
            select 1
            from public.user_roles ur
            where ur.user_id = i.owner_user_id
              and ur.role = 'organization'::public.app_role
              and ur.deleted_at is null
          )
          and i.status in (
                        'available'::public.item_status,
            'in_cart'::public.item_status,
            'reserved'::public.item_status
          )
        group by i.owner_user_id
        order by count(*) desc, max(i.updated_at) desc
        limit v_limit
      ) x
      inner join public.user_profiles up
        on up.user_id = x.user_id
        and up.deleted_at is null
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_shop_featured_lenders(integer) is
  'Boutique : prêteuses (pièces au catalogue), hors soi, hors corporate, hors rôle organization, hors email @segnashare.com (non null).';


-- === patched from 20260502120000_shop_section_rpcs.sql ===

-- Sections boutique : tri par likes globaux (item_favorites), favoris membre, exclusions pour « pour vous ».

-- ---------------------------------------------------------------------------
-- Base enrichie identique au catalogue (get_shop_catalog_items) + compteur likes
-- ---------------------------------------------------------------------------

create or replace function public.get_shop_most_liked_items(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 10), 100));

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
      order by s.like_count desc, s.sort_key desc
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
      coalesce(fc.cnt, 0)::bigint as like_count,
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
    left join (
      select item_id, count(*)::bigint as cnt
      from public.item_favorites
      where deleted_at is null
      group by item_id
    ) fc on fc.item_id = i.id
    inner join public.users u on u.id = i.owner_user_id
    where i.deleted_at is null
      and i.owner_user_id <> v_uid
      and i.status in (
                'available'::public.item_status,
        'in_cart'::public.item_status,
        'reserved'::public.item_status
      )
      and u.status is distinct from 'corporate_inventory'::public.user_status
    order by coalesce(fc.cnt, 0) desc, i.updated_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_shop_most_liked_items(integer) is
  'Boutique : top N pièces par nombre de likes (favoris membres), hors soi.';

grant execute on function public.get_shop_most_liked_items(integer) to authenticated;


create or replace function public.get_shop_most_liked_fraction(p_fraction numeric default 0.10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_n bigint;
  v_k integer;
  v_frac numeric;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_frac := greatest(0.01, least(coalesce(p_fraction, 0.10), 1.0));

  select count(*)::bigint into v_n
  from public.items i
  inner join public.users u on u.id = i.owner_user_id
  where i.deleted_at is null
    and i.owner_user_id <> v_uid
    and i.status in (
            'available'::public.item_status,
      'in_cart'::public.item_status,
      'reserved'::public.item_status
    )
    and u.status is distinct from 'corporate_inventory'::public.user_status;

  v_k := greatest(1, least(500, ceil(coalesce(v_n, 0) * v_frac)::integer));

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
      order by s.like_count desc, s.sort_key desc
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
      coalesce(fc.cnt, 0)::bigint as like_count,
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
    left join (
      select item_id, count(*)::bigint as cnt
      from public.item_favorites
      where deleted_at is null
      group by item_id
    ) fc on fc.item_id = i.id
    inner join public.users u on u.id = i.owner_user_id
    where i.deleted_at is null
      and i.owner_user_id <> v_uid
      and i.status in (
                'available'::public.item_status,
        'in_cart'::public.item_status,
        'reserved'::public.item_status
      )
      and u.status is distinct from 'corporate_inventory'::public.user_status
    order by coalesce(fc.cnt, 0) desc, i.updated_at desc
    limit v_k
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_shop_most_liked_fraction(numeric) is
  'Boutique : top ceil(N * fraction) pièces par likes, N = pièces éligibles catalogue.';

grant execute on function public.get_shop_most_liked_fraction(numeric) to authenticated;


create or replace function public.get_shop_user_favorite_items(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 200), 300));

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
      order by s.fav_at desc
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
      f.created_at as fav_at,
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
    from public.item_favorites f
    inner join public.items i on i.id = f.item_id
    left join public.item_categories cat on cat.id = i.item_category_id
    left join public.sizes sz on sz.id = i.item_size_id
    left join public.item_materiaux mat on mat.id = i.item_materiaux_id
    left join public.item_couleurs col on col.id = i.item_couleur_id
    left join public.item_brands br on br.id = i.item_brand_id
    inner join public.users u on u.id = i.owner_user_id
    where f.user_id = v_uid
      and f.deleted_at is null
      and i.deleted_at is null
      and i.status in (
                'available'::public.item_status,
        'in_cart'::public.item_status,
        'reserved'::public.item_status
      )
      and u.status is distinct from 'corporate_inventory'::public.user_status
    order by f.created_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_shop_user_favorite_items(integer) is
  'Boutique : pièces likées par le membre, ordre favoris récents.';

grant execute on function public.get_shop_user_favorite_items(integer) to authenticated;


create or replace function public.get_shop_catalog_excluding_user_favorites(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 200), 300));

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
      order by s.sort_key desc
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
    inner join public.users u on u.id = i.owner_user_id
    where i.deleted_at is null
      and i.owner_user_id <> v_uid
      and i.status in (
                'available'::public.item_status,
        'in_cart'::public.item_status,
        'reserved'::public.item_status
      )
      and u.status is distinct from 'corporate_inventory'::public.user_status
      and not exists (
        select 1
        from public.item_favorites f
        where f.item_id = i.id
          and f.user_id = v_uid
          and f.deleted_at is null
      )
    order by i.updated_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_shop_catalog_excluding_user_favorites(integer) is
  'Boutique : catalogue hors pièces likées par le membre (pour « susceptibles de vous plaire »).';

grant execute on function public.get_shop_catalog_excluding_user_favorites(integer) to authenticated;


-- === patched excerpt: 20260504220000_admin_phantom_mode.sql (shop + home feed) ===

create or replace function public.get_shop_catalog_items(p_limit integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 120), 200));

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
      order by s.sort_key desc
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
    left join public.item_categories cat
      on cat.id = i.item_category_id
    left join public.sizes sz
      on sz.id = i.item_size_id
    left join public.item_materiaux mat
      on mat.id = i.item_materiaux_id
    left join public.item_couleurs col
      on col.id = i.item_couleur_id
    left join public.item_brands br
      on br.id = i.item_brand_id
    where i.deleted_at is null
      and i.owner_user_id <> v_uid
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
      and not exists (
        select 1
        from public.users u2
        where u2.id = i.owner_user_id
          and coalesce(u2.phantom_mode, false)
      )
    order by i.updated_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_shop_catalog_items(integer) is
  'Catalogue shop : pièces listées / panier avec métadonnées et état (security definer).';

grant execute on function public.get_shop_catalog_items(integer) to authenticated;

create or replace function public.get_home_feed_v1(
  p_limit integer default 20,
  p_cursor_score numeric default null,
  p_cursor_entity_id uuid default null,
  p_exploration_ratio numeric default 0.2
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_explore_ratio numeric;
  v_result jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 60));
  v_explore_ratio := greatest(0, least(coalesce(p_exploration_ratio, 0.2), 0.5));

  with
  item_agg as (
    select
      x.item_id,
      count(*) filter (where x.interaction_type = 'like') as like_count,
      count(*) filter (where x.interaction_type = 'cart_add') as cart_count
    from public.member_item_interactions x
    where x.created_at >= now() - interval '30 days'
    group by x.item_id
  ),
  profile_agg as (
    select
      x.profile_user_id,
      count(*) filter (where x.interaction_type = 'like') as like_count,
      count(*) filter (where x.interaction_type = 'dig') as dig_count
    from public.member_profile_interactions x
    where x.created_at >= now() - interval '30 days'
    group by x.profile_user_id
  ),
  member_item_penalties as (
    select
      x.item_id,
      count(*) filter (where x.interaction_type = 'pass') as pass_count
    from public.member_item_interactions x
    where x.member_user_id = v_uid
      and x.created_at >= now() - interval '30 days'
    group by x.item_id
  ),
  member_profile_penalties as (
    select
      x.profile_user_id,
      count(*) filter (where x.interaction_type = 'pass') as pass_count
    from public.member_profile_interactions x
    where x.member_user_id = v_uid
      and x.created_at >= now() - interval '30 days'
    group by x.profile_user_id
  ),
  item_candidates as (
    select
      'item'::public.feed_entity_type as entity_type,
      i.id as entity_id,
      i.id as item_id,
      null::uuid as profile_user_id,
      i.owner_user_id as owner_user_id,
      i.title as title,
      i.description as description,
      i.price_points as price_points,
      i.status::text as status,
      i.photos as photos,
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
          else ich.condition_score
        end
        from public.item_condition_history ich
        where ich.item_id = i.id
          and ich.status = 'confirmed'
        order by ich.created_at desc
        limit 1
      ) as condition_label,
      up.display_name as profile_display_name,
      up.city as profile_city,
      up.age as profile_age,
      coalesce(iah.seen_count, 0) as seen_count,
      coalesce(mip.pass_count, 0) as member_pass_count,
      (
        50
        + case when i.status::text = 'available' then 16 else 9 end
        + least(20, ln(1 + (coalesce(ia.like_count, 0) * 2 + coalesce(ia.cart_count, 0) * 3)) * 5)
        - least(18, coalesce(iah.seen_count, 0) * 3)
        - least(18, coalesce(mip.pass_count, 0) * 6)
      )::numeric as base_score
    from public.items i
    left join public.user_profiles up
      on up.user_id = i.owner_user_id and up.deleted_at is null
    left join public.item_categories cat
      on cat.id = i.item_category_id
    left join public.sizes sz
      on sz.id = i.item_size_id
    left join public.item_materiaux mat
      on mat.id = i.item_materiaux_id
    left join public.item_couleurs col
      on col.id = i.item_couleur_id
    left join public.item_brands br
      on br.id = i.item_brand_id
    left join item_agg ia
      on ia.item_id = i.id
    left join member_item_penalties mip
      on mip.item_id = i.id
    left join public.member_feed_entity_history iah
      on iah.member_user_id = v_uid
      and iah.entity_type = 'item'
      and iah.item_id = i.id
    where i.deleted_at is null
      and i.owner_user_id <> v_uid
      and i.status = 'available'::public.item_status
      and (iah.hidden_until is null or iah.hidden_until <= now())
      and not exists (
        select 1
        from public.users u
        where u.id = i.owner_user_id
          and u.status = 'corporate_inventory'::public.user_status
      )
      and not exists (
        select 1
        from public.users u2
        where u2.id = i.owner_user_id
          and coalesce(u2.phantom_mode, false)
      )
  ),
  profile_candidates as (
    select
      'profile'::public.feed_entity_type as entity_type,
      up.user_id as entity_id,
      null::uuid as item_id,
      up.user_id as profile_user_id,
      null::uuid as owner_user_id,
      null::text as title,
      null::text as description,
      null::integer as price_points,
      null::text as status,
      up.photos as photos,
      null::text as category_label,
      null::text as size_label,
      null::text as materials_label,
      null::text as color_label,
      null::text as brand_label,
      null::text as condition_label,
      coalesce(nullif(trim(up.display_name), ''), 'Membre Segna') as profile_display_name,
      up.city as profile_city,
      up.age as profile_age,
      coalesce(ph.seen_count, 0) as seen_count,
      coalesce(mpp.pass_count, 0) as member_pass_count,
      (
        44
        + least(18, ln(1 + (coalesce(pa.like_count, 0) * 2 + coalesce(pa.dig_count, 0) * 3)) * 5)
        - least(15, coalesce(ph.seen_count, 0) * 2)
        - least(20, coalesce(mpp.pass_count, 0) * 7)
      )::numeric as base_score
    from public.user_profiles up
    left join profile_agg pa
      on pa.profile_user_id = up.user_id
    left join member_profile_penalties mpp
      on mpp.profile_user_id = up.user_id
    left join public.member_feed_entity_history ph
      on ph.member_user_id = v_uid
      and ph.entity_type = 'profile'
      and ph.profile_user_id = up.user_id
    where up.deleted_at is null
      and up.user_id <> v_uid
      and (ph.hidden_until is null or ph.hidden_until <= now())
      and public.is_profile_eligible_for_home_feed(v_uid, up.user_id, 30)
      and not exists (
        select 1
        from public.users u
        where u.id = up.user_id
          and u.status = 'corporate_inventory'::public.user_status
      )
      and not exists (
        select 1
        from public.users u2
        where u2.id = up.user_id
          and coalesce(u2.phantom_mode, false)
      )
  ),
  merged as (
    select * from item_candidates
    union all
    select * from profile_candidates
  ),
  with_exploration as (
    select
      m.*,
      (
        abs(
          (
            ('x' || substr(md5(v_uid::text || ':' || m.entity_type::text || ':' || m.entity_id::text || ':' || current_date::text), 1, 8))::bit(32)::bigint
          )
        )::numeric / 4294967295.0
      ) as explore_rand
    from merged m
  ),
  scored as (
    select
      x.*,
      case
        when x.explore_rand < v_explore_ratio
          then (12 * (1 - (x.explore_rand / nullif(v_explore_ratio, 0))))
        else 0
      end as explore_boost,
      (
        x.base_score
        + case
            when x.explore_rand < v_explore_ratio
              then (12 * (1 - (x.explore_rand / nullif(v_explore_ratio, 0))))
            else 0
          end
      )::numeric as final_score
    from with_exploration x
  ),
  paged as (
    select *
    from scored s
    where
      (
        p_cursor_score is null
        or s.final_score < p_cursor_score
        or (s.final_score = p_cursor_score and s.entity_id > p_cursor_entity_id)
      )
    order by s.final_score desc, s.entity_id asc
    limit v_limit + 1
  ),
  cards as (
    select *
    from paged
    order by final_score desc, entity_id asc
    limit v_limit
  ),
  next_cursor as (
    select
      p.final_score as next_score,
      p.entity_id as next_entity_id
    from paged p
    order by p.final_score desc, p.entity_id asc
    offset v_limit
    limit 1
  )
  select jsonb_build_object(
    'cards',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'kind', c.entity_type::text,
            'id', c.entity_id,
            'item_id', c.item_id,
            'profile_user_id', c.profile_user_id,
            'owner_user_id', c.owner_user_id,
            'title', c.title,
            'description', c.description,
            'price_points', c.price_points,
            'status', c.status,
            'photos', c.photos,
            'category_label', c.category_label,
            'size_label', c.size_label,
            'materials_label', c.materials_label,
            'color_label', c.color_label,
            'brand_label', c.brand_label,
            'condition_label', c.condition_label,
            'profile_display_name', c.profile_display_name,
            'profile_city', c.profile_city,
            'profile_age', c.profile_age,
            'score', c.final_score,
            'base_score', c.base_score,
            'explore_boost', c.explore_boost
          )
          order by c.final_score desc, c.entity_id asc
        )
        from cards c
      ),
      '[]'::jsonb
    ),
    'next_cursor',
    (
      select case
        when n.next_entity_id is null then null
        else jsonb_build_object(
          'score', n.next_score,
          'entity_id', n.next_entity_id
        )
      end
      from next_cursor n
    )
  ) into v_result;

  return coalesce(v_result, jsonb_build_object('cards', '[]'::jsonb, 'next_cursor', null));
end;
$$;

grant execute on function public.get_home_feed_v1(integer, numeric, uuid, numeric) to authenticated;

-- === patched excerpt: 20260507130000_cms_guest_fallback_shop_items_by_ids.sql ===

create or replace function public.get_shop_catalog_items_by_ids(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

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
      order by s.ord
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
      array_position(p_item_ids, i.id) as ord,
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
    where i.id = any(p_item_ids)
      and i.deleted_at is null
      and i.owner_user_id <> v_uid
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
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

grant execute on function public.get_shop_catalog_items_by_ids(uuid[]) to authenticated;

comment on function public.get_shop_catalog_items_by_ids(uuid[]) is
  'Détails catalogue pour une liste de pièces (références CMS hub), ordre conservé.';

-- === patched excerpt: 20260523150000_item_intake_pre_subscribe_proposal.sql (items_after_insert) ===

create or replace function public.items_after_insert_ensure_item_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := '{}'::jsonb;
begin
  if coalesce(new.pre_subscribe_proposal, false) is true then
    v_meta := jsonb_build_object('intake_path', 'pre_subscribe_proposal');
  elsif new.status::text = 'draft_deleted' then
    v_meta := jsonb_build_object('legacy_items_status', 'draft_deleted');
  end if;

  insert into public.item_intake (item_id, listing_stage, metadata)
  values (
    new.id,
    case new.status::text
      when 'draft' then 'draft'::public.item_intake_listing_stage
      when 'draft_deleted' then 'draft'::public.item_intake_listing_stage
            else 'validated'::public.item_intake_listing_stage
    end,
    v_meta
  )
  on conflict (item_id) do nothing;
  return new;
end;
$$;

comment on type public.item_status is
  'Statut operational item. available=panier/reservation possibles ; cleaning=pressing logistique post-retour.';
