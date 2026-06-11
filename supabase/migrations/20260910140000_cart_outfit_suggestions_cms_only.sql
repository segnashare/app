-- Suggestions panier « Complétez votre tenue » : uniquement companions CMS + disponibles.

create or replace function public.get_cart_outfit_suggestions(
  p_cart_item_ids uuid[],
  p_exclude_item_ids uuid[] default '{}'::uuid[],
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_exclude uuid[];
  v_cart_ids uuid[];
  v_cms_ids uuid[];
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 10), 20));
  v_cart_ids := coalesce(p_cart_item_ids, '{}'::uuid[]);
  v_exclude := coalesce(p_exclude_item_ids, '{}'::uuid[]) || v_cart_ids;

  if cardinality(v_cart_ids) = 0 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  -- Companions des tenues CMS publiées, ancrées sur une pièce du panier.
  select coalesce(array_agg(distinct c.companion_item_id order by c.companion_item_id), '{}'::uuid[])
  into v_cms_ids
  from public.item_outfit_looks l
  join public.item_outfit_companion_items c on c.outfit_id = l.id
  join public.items ci on ci.id = c.companion_item_id
  where l.published = true
    and l.anchor_item_id = any(v_cart_ids)
    and not (c.companion_item_id = any(v_exclude))
    and ci.deleted_at is null
    and ci.owner_user_id <> v_uid
    and ci.status = 'available'::public.item_status
    and not exists (
      select 1
      from public.users u
      where u.id = ci.owner_user_id
        and u.status = 'corporate_inventory'::public.user_status
    )
    and not exists (
      select 1
      from public.users u2
      where u2.id = ci.owner_user_id
        and coalesce(u2.phantom_mode, false)
    );

  with
  candidate_ids as (
    select cid as id, array_position(v_cms_ids, cid) as cms_ord
    from unnest(v_cms_ids) as cid
  ),
  ranked as (
    select
      c.id,
      row_number() over (order by c.cms_ord asc nulls last) as rn
    from candidate_ids c
    join public.items i on i.id = c.id
  ),
  picked as (
    select id, rn
    from ranked
    where rn <= v_limit
  )
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
      p.rn as ord,
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
    join picked p on p.id = i.id
    left join public.item_categories cat on cat.id = i.item_category_id
    left join public.sizes sz on sz.id = i.item_size_id
    left join public.item_materiaux mat on mat.id = i.item_materiaux_id
    left join public.item_couleurs col on col.id = i.item_couleur_id
    left join public.item_brands br on br.id = i.item_brand_id
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_cart_outfit_suggestions(uuid[], uuid[], integer) is
  'Suggestions panier : companions des tenues CMS (pièce panier = ancre), statut available uniquement.';
