-- Nouveautés / discover : top fraction des pièces par created_at (aligné badge « New » marketing ~20 %).

create or replace function public.get_shop_newest_fraction(p_fraction numeric default 0.20)
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

  v_frac := greatest(0.01, least(coalesce(p_fraction, 0.20), 1.0));

  select count(*)::bigint into v_n
  from public.items i
  inner join public.users u on u.id = i.owner_user_id
  where i.deleted_at is null
    and i.owner_user_id <> v_uid
    and i.status in (
      'available'::public.item_status,
      'in_cart'::public.item_status,
      'reserved'::public.item_status,
      'sold'::public.item_status
    )
    and u.status is distinct from 'corporate_inventory'::public.user_status
    and coalesce(u.phantom_mode, false) is not true;

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
        'condition_score', s.condition_score,
        'is_new', true
      )
      order by
        case when s.status = 'sold' then 1 else 0 end asc,
        s.created_at desc
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
      i.created_at,
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
        'reserved'::public.item_status,
        'sold'::public.item_status
      )
      and u.status is distinct from 'corporate_inventory'::public.user_status
      and coalesce(u.phantom_mode, false) is not true
    order by
      case when i.status = 'sold'::public.item_status then 1 else 0 end asc,
      i.created_at desc
    limit v_k
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_shop_newest_fraction(numeric) is
  'Boutique / Nouveautés : top ceil(N * fraction) pièces par created_at desc (badge New).';

grant execute on function public.get_shop_newest_fraction(numeric) to authenticated;
