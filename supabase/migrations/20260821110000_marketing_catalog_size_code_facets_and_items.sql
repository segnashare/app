-- Expose `sizes.code` (ex. shoes:38 vs bottom:38) sur les facettes catalogue et les payloads pièces,
-- pour séparer pointures / tailles vêtements sur le site marketing.

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
      sz.label as size_label,
      sz.code as size_code
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
          select distinct jsonb_build_object(
            'id', b.item_size_id,
            'label', b.size_label,
            'code', coalesce(b.size_code, '')
          ) as obj
          from for_sizes b
          where b.item_size_id is not null and nullif(trim(b.size_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    )
  );
$$;

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
      sz.label as size_label,
      sz.code as size_code
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
          select distinct jsonb_build_object(
            'id', b.item_size_id,
            'label', b.size_label,
            'code', coalesce(b.size_code, '')
          ) as obj
          from base b
          where b.item_size_id is not null and nullif(trim(b.size_label), '') is not null
        ) x
      ),
      '[]'::jsonb
    )
  );
$$;

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
        'size_code', coalesce(s.size_code, ''),
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
      sz.code as size_code,
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
        'size_code', coalesce(s.size_code, ''),
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
      sz.code as size_code,
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

comment on function public.get_marketing_website_catalog_facets() is
  'Facettes (catégories, marques, couleurs, tailles) pour le catalogue marketing. service_role.';

revoke all on function public.get_marketing_website_catalog_facets() from public;
revoke all on function public.get_marketing_website_catalog_facets() from anon;
revoke all on function public.get_marketing_website_catalog_facets() from authenticated;
grant execute on function public.get_marketing_website_catalog_facets() to service_role;

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

comment on function public.get_marketing_website_catalog_items_by_ids(uuid[]) is
  'Pièces catalogue pour le site marketing (UUID, ordre conservé). Rôle service_role uniquement.';

revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from public;
revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from anon;
revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from authenticated;
grant execute on function public.get_marketing_website_catalog_items_by_ids(uuid[]) to service_role;
