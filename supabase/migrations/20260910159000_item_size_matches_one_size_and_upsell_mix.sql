-- Taille membre : haut / bas / chaussures (profil) + taille unique (null ou code dédié).
-- Upsell checkout : diversifier les départements complémentaires (pas que chaussures).

create or replace function public.item_size_matches_member_profile(p_item_size_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Accessoires, sacs, etc. sans taille catalogue
    p_item_size_id is null
    -- Haut / bas / chaussures : une des tailles enregistrées au profil
    or exists (
      select 1
      from public.user_profiles up
      join public.user_profile_sizes upsz on upsz.user_profile_id = up.id
      where up.user_id = p_user_id
        and upsz.size_id = p_item_size_id
    )
    -- Taille unique explicite dans le catalogue
    or exists (
      select 1
      from public.sizes sz
      where sz.id = p_item_size_id
        and (
          lower(trim(coalesce(sz.code, ''))) like 'one_size:%'
          or lower(trim(coalesce(sz.code, ''))) like 'unique:%'
          or lower(trim(coalesce(sz.label, ''))) in ('tu', 'taille unique', 'unique')
        )
    );
$$;

comment on function public.item_size_matches_member_profile(uuid, uuid) is
  'Profil membre (haut/bas/chaussures) ou pièce sans taille / taille unique.';

create or replace function public.get_cart_upsell_suggestions(
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
  v_brand_ids uuid[];
  v_cart_departments text[];
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 10), 10));
  v_cart_ids := coalesce(p_cart_item_ids, '{}'::uuid[]);
  v_exclude := coalesce(p_exclude_item_ids, '{}'::uuid[]) || v_cart_ids;

  select coalesce(array_agg(distinct i.item_brand_id) filter (where i.item_brand_id is not null), '{}'::uuid[])
  into v_brand_ids
  from public.items i
  where i.id = any(v_cart_ids);

  select coalesce(array_agg(distinct public.resolve_item_department_slug(i.item_category_id)) filter (
    where public.resolve_item_department_slug(i.item_category_id) is not null
  ), '{}'::text[])
  into v_cart_departments
  from public.items i
  where i.id = any(v_cart_ids);

  with
  candidates as (
    select
      i.id,
      coalesce(public.resolve_item_department_slug(i.item_category_id), '_other') as dept_slug,
      case when i.item_brand_id = any(v_brand_ids) then 0 else 1 end as brand_rank,
      i.updated_at
    from public.items i
    where i.deleted_at is null
      and i.owner_user_id <> v_uid
      and not (i.id = any(v_exclude))
      and coalesce(i.price_points, 0) < 50
      and i.status = 'available'::public.item_status
      and public.item_size_matches_member_profile(i.item_size_id, v_uid)
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
      and (
        cardinality(v_cart_departments) = 0
        or public.resolve_item_department_slug(i.item_category_id) is null
        or not (public.resolve_item_department_slug(i.item_category_id) = any(v_cart_departments))
      )
  ),
  ranked as (
    select
      c.id,
      row_number() over (
        partition by c.dept_slug
        order by c.brand_rank asc, c.updated_at desc
      ) as dept_rn,
      c.brand_rank,
      c.updated_at
    from candidates c
  ),
  picked as (
    select id, dept_rn, brand_rank, updated_at
    from ranked
    order by
      dept_rn asc,
      brand_rank asc,
      updated_at desc
    limit v_limit
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
      row_number() over (order by p.dept_rn, p.brand_rank, p.updated_at desc) as ord,
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

comment on function public.get_cart_upsell_suggestions(uuid[], uuid[], integer) is
  'Upsell checkout : available, taille membre (haut/bas/chaussures + taille unique), < 50 crédits, mix départements, max 10.';
