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
