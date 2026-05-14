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
