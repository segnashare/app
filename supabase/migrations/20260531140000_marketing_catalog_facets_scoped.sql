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
