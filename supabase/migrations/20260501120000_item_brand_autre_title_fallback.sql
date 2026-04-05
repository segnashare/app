-- Marque « Autre » sans item_custom_brand_label : afficher le titre de la pièce (tronqué),
-- aligné sur fetch-item-detail-client (format côté app pour la fiche).

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
        'listed'::public.item_status,
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
      and i.status in ('listed', 'available')
      and (iah.hidden_until is null or iah.hidden_until <= now())
      and not exists (
        select 1
        from public.users u
        where u.id = i.owner_user_id
          and u.status = 'corporate_inventory'::public.user_status
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
