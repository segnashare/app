-- « Complète ta tenue » : plus de compagnons CMS / style looks.
-- 1) Favoris du membre (available|in_cart, hors panier)
-- 2) Sinon complément aléatoire (available|in_cart, taille profil + taille unique)

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
    -- Taille unique explicite dans le catalogue (label ou code top:TU / bottom:TU / one_size:…)
    or exists (
      select 1
      from public.sizes sz
      where sz.id = p_item_size_id
        and (
          lower(trim(coalesce(sz.code, ''))) like 'one_size:%'
          or lower(trim(coalesce(sz.code, ''))) like 'unique:%'
          or lower(trim(coalesce(sz.code, ''))) like '%:tu'
          or lower(trim(coalesce(sz.label, ''))) in ('tu', 'taille unique', 'unique')
        )
    );
$$;

comment on function public.item_size_matches_member_profile(uuid, uuid) is
  'Profil membre (haut/bas/chaussures) ou pièce sans taille / taille unique (label ou code *:TU).';

create or replace function public.item_borrowable_for_outfit_suggestion(
  p_item_id uuid,
  p_borrower_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and i.deleted_at is null
      and i.owner_user_id is distinct from p_borrower_user_id
      and i.status in (
        'available'::public.item_status,
        'in_cart'::public.item_status
      )
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
  );
$$;

comment on function public.item_borrowable_for_outfit_suggestion(uuid, uuid) is
  'Pièce shoppable pour suggestions tenue : available/in_cart, hors stock perso / corporate / phantom (sans filtre taille).';

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

  with
  liked_candidates as (
    select
      f.item_id as id,
      0 as source_rank,
      extract(epoch from coalesce(f.updated_at, f.created_at))::bigint as sort_rank
    from public.item_favorites f
    where f.user_id = v_uid
      and f.deleted_at is null
      and not (f.item_id = any(v_exclude))
      and public.item_borrowable_for_outfit_suggestion(f.item_id, v_uid)
    order by coalesce(f.updated_at, f.created_at) desc
    limit v_limit
  ),
  liked_ids as (
    select array_agg(id) as ids, count(*)::integer as cnt
    from liked_candidates
  ),
  random_candidates as (
    select
      i.id,
      1 as source_rank,
      (extract(epoch from i.updated_at) * 1000 + (random() * 1000)::bigint)::bigint as sort_rank
    from public.items i
    cross join liked_ids li
    where coalesce(li.cnt, 0) < v_limit
      and i.deleted_at is null
      and i.owner_user_id is distinct from v_uid
      and not (i.id = any(v_exclude))
      and (li.ids is null or not (i.id = any(li.ids)))
      and i.status in (
        'available'::public.item_status,
        'in_cart'::public.item_status
      )
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
    order by random()
    limit greatest(0, v_limit - coalesce((select cnt from liked_ids), 0))
  ),
  merged as (
    select * from liked_candidates
    union all
    select * from random_candidates
  ),
  ranked as (
    select
      id,
      row_number() over (order by source_rank asc, sort_rank desc) as rn
    from merged
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
  'Complète ta tenue : favoris disponibles hors panier, sinon aléatoire taille membre / taille unique.';
