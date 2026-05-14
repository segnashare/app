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
