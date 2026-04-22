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
