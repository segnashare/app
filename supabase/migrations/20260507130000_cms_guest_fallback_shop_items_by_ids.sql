-- CMS catalogue : si aucune frame publiée pour le plan effectif, reprendre celles du plan « guest ».
-- Shop : charger des pièces par UUID (références CMS hors fenêtre get_shop_catalog_items).

create or replace function public.get_cms_catalog_section(p_section_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_key text;
  v_section_id uuid;
  v_config jsonb;
  v_frames jsonb;
begin
  v_plan := public.get_effective_plan_code_for_cms();
  v_key := nullif(trim(coalesce(p_section_key, '')), '');
  if v_key is null then
    raise exception 'section_key requis';
  end if;

  select s.id, coalesce(s.published_section_config, '{}'::jsonb)
    into v_section_id, v_config
  from public.cms_app_sections s
  where s.section_key = v_key
  limit 1;

  if v_section_id is null then
    return jsonb_build_object(
      'config', '{}'::jsonb,
      'frames', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', f.plan_code,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  into v_frames
  from public.cms_app_section_frames f
  where f.section_id = v_section_id
    and f.plan_code = v_plan
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';

  if coalesce(jsonb_array_length(v_frames), 0) = 0 and v_plan is distinct from 'guest' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'frame_type', f.frame_type,
          'sort_order', f.sort_order,
          'plan_code', f.plan_code,
          'payload', f.published_payload
        )
        order by f.sort_order asc, f.created_at asc
      ),
      '[]'::jsonb
    )
    into v_frames
    from public.cms_app_section_frames f
    where f.section_id = v_section_id
      and f.plan_code = 'guest'
      and f.published_payload is not null
      and jsonb_typeof(f.published_payload) = 'object';
  end if;

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'frames', coalesce(v_frames, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_cms_section_frames(p_section_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_key text;
  v_section_id uuid;
  v_rows jsonb;
begin
  v_plan := public.get_effective_plan_code_for_cms();
  v_key := nullif(trim(coalesce(p_section_key, '')), '');
  if v_key is null then
    raise exception 'section_key requis';
  end if;

  select s.id into v_section_id
  from public.cms_app_sections s
  where s.section_key = v_key
  limit 1;

  if v_section_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', f.plan_code,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.cms_app_section_frames f
  where f.section_id = v_section_id
    and f.plan_code = v_plan
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';

  if coalesce(jsonb_array_length(v_rows), 0) = 0 and v_plan is distinct from 'guest' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'frame_type', f.frame_type,
          'sort_order', f.sort_order,
          'plan_code', f.plan_code,
          'payload', f.published_payload
        )
        order by f.sort_order asc, f.created_at asc
      ),
      '[]'::jsonb
    )
    into v_rows
    from public.cms_app_section_frames f
    where f.section_id = v_section_id
      and f.plan_code = 'guest'
      and f.published_payload is not null
      and jsonb_typeof(f.published_payload) = 'object';
  end if;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

comment on function public.get_cms_catalog_section(text) is
  'Config publiée + frames (plan effectif, sinon repli guest si aucune frame pour le plan).';

comment on function public.get_cms_section_frames(text) is
  'Frames publiées (plan effectif, sinon repli guest si vide).';

-- ---------------------------------------------------------------------------
-- Pièces catalogue par IDs (même forme que get_shop_catalog_items.items[])
-- ---------------------------------------------------------------------------

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
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

grant execute on function public.get_shop_catalog_items_by_ids(uuid[]) to authenticated;

comment on function public.get_shop_catalog_items_by_ids(uuid[]) is
  'Détails catalogue pour une liste de pièces (références CMS hub), ordre conservé.';
