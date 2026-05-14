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


-- === patched from 20260529120000_marketing_website_catalog_facets.sql ===

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


-- === patched from 20260529110000_marketing_website_catalog_items_list.sql ===

-- Liste catalogue marketing (site web), sans liste d’UUID — même charge utile que get_marketing_website_catalog_items_by_ids.

create or replace function public.get_marketing_website_catalog_items(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_limit integer;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 200), 500));

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
      order by s.sort_key desc
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
    order by i.updated_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_marketing_website_catalog_items(integer) is
  'Liste catalogue site marketing (tri date décroissante). Rôle service_role uniquement.';

revoke all on function public.get_marketing_website_catalog_items(integer) from public;
revoke all on function public.get_marketing_website_catalog_items(integer) from anon;
revoke all on function public.get_marketing_website_catalog_items(integer) from authenticated;
grant execute on function public.get_marketing_website_catalog_items(integer) to service_role;


-- === patched from 20260529100000_marketing_website_catalog_items_by_ids.sql ===

-- Catalogue marketing (site web) : lecture par UUID sans session membre.
-- Réservé au service_role (clé serveur Next.js) — pas d’exécution anon.

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

comment on function public.get_marketing_website_catalog_items_by_ids(uuid[]) is
  'Pièces catalogue pour le site marketing (UUID, ordre conservé). Rôle service_role uniquement.';

revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from public;
revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from anon;
revoke all on function public.get_marketing_website_catalog_items_by_ids(uuid[]) from authenticated;
grant execute on function public.get_marketing_website_catalog_items_by_ids(uuid[]) to service_role;


-- === patched from 20260503110000_shop_featured_lenders_email_and_segna_display.sql ===

-- Compte « Segna S. » sans email @segnashare.com : rôle organization explicite.
insert into public.user_roles (user_id, role)
select up.user_id, 'organization'::public.app_role
from public.user_profiles up
inner join public.users u on u.id = up.user_id
where u.deleted_at is null
  and up.deleted_at is null
  and trim(coalesce(up.display_name, '')) = 'Segna S.'
on conflict (user_id, role) do update
set
  deleted_at = null,
  updated_at = now();

-- Exclure les emails @segnashare.com sans laisser passer email NULL (bug précédent).
create or replace function public.get_shop_featured_lenders(p_limit integer default 9)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 9), 24));

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'user_id', x.user_id,
          'display_name', up.display_name,
          'city', up.city,
          'item_count', x.cnt,
          'photos', up.photos
        )
        order by x.cnt desc, x.last_item_at desc nulls last
      )
      from (
        select
          i.owner_user_id as user_id,
          count(*)::integer as cnt,
          max(i.updated_at) as last_item_at
        from public.items i
        inner join public.users u on u.id = i.owner_user_id
        where i.deleted_at is null
          and i.owner_user_id is distinct from v_uid
          and u.status is distinct from 'corporate_inventory'::public.user_status
          and not (
            u.email is not null
            and lower(u.email) like '%@segnashare.com'
          )
          and not exists (
            select 1
            from public.user_roles ur
            where ur.user_id = i.owner_user_id
              and ur.role = 'organization'::public.app_role
              and ur.deleted_at is null
          )
          and i.status in (
                        'available'::public.item_status,
            'in_cart'::public.item_status,
            'reserved'::public.item_status
          )
        group by i.owner_user_id
        order by count(*) desc, max(i.updated_at) desc
        limit v_limit
      ) x
      inner join public.user_profiles up
        on up.user_id = x.user_id
        and up.deleted_at is null
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_shop_featured_lenders(integer) is
  'Boutique : prêteuses (pièces au catalogue), hors soi, hors corporate, hors rôle organization, hors email @segnashare.com (non null).';


-- === patched from 20260502120000_shop_section_rpcs.sql ===

-- Sections boutique : tri par likes globaux (item_favorites), favoris membre, exclusions pour « pour vous ».

-- ---------------------------------------------------------------------------
-- Base enrichie identique au catalogue (get_shop_catalog_items) + compteur likes
-- ---------------------------------------------------------------------------

create or replace function public.get_shop_most_liked_items(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_items jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 10), 100));

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
      order by s.like_count desc, s.sort_key desc
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
      coalesce(fc.cnt, 0)::bigint as like_count,
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
