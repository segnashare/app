-- Tenues éditoriales par pièce (upsell fiche item + panier/checkout).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.item_outfit_looks (
  id uuid primary key default gen_random_uuid(),
  anchor_item_id uuid not null references public.items (id) on delete cascade,
  title text not null default '',
  intro text not null default '',
  published boolean not null default false,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_outfit_looks_anchor_item_id_key unique (anchor_item_id)
);

create table if not exists public.item_outfit_companion_items (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references public.item_outfit_looks (id) on delete cascade,
  companion_item_id uuid not null references public.items (id) on delete cascade,
  sort_order integer not null default 0,
  role_label text null,
  created_at timestamptz not null default now(),
  constraint item_outfit_companion_items_outfit_companion_key unique (outfit_id, companion_item_id)
);

create index if not exists idx_item_outfit_companion_items_outfit_sort
  on public.item_outfit_companion_items (outfit_id, sort_order asc);

create index if not exists idx_item_outfit_looks_published
  on public.item_outfit_looks (published)
  where published = true;

alter table public.item_outfit_looks enable row level security;
alter table public.item_outfit_companion_items enable row level security;

create policy item_outfit_looks_select_published
  on public.item_outfit_looks
  for select
  to authenticated
  using (published = true);

create policy item_outfit_companion_items_select_published
  on public.item_outfit_companion_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.item_outfit_looks l
      where l.id = outfit_id
        and l.published = true
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers : département catalogue (vetements / chaussures / sacs / accessoires)
-- ---------------------------------------------------------------------------

create or replace function public.normalize_catalog_department_label(p_label text)
returns text
language sql
immutable
as $$
  select lower(
    trim(
      both
      from translate(
        coalesce(p_label, ''),
        'àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ',
        'aaaeeeeiioouuuycaaaeeeeiioouuuyc'
      )
    )
  );
$$;

create or replace function public.resolve_item_department_slug(p_category_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_root_label text;
  v_norm text;
begin
  if p_category_id is null then
    return null;
  end if;

  with recursive ancestors as (
    select c.id, c.parent_category_id, c.name
    from public.item_categories c
    where c.id = p_category_id
    union all
    select p.id, p.parent_category_id, p.name
    from public.item_categories p
    join ancestors a on p.id = a.parent_category_id
  )
  select a.name
  into v_root_label
  from ancestors a
  where a.parent_category_id is null
  limit 1;

  v_norm := public.normalize_catalog_department_label(v_root_label);

  if v_norm in ('vetements', 'vetement') then
    return 'vetements';
  elsif v_norm in ('accessoires', 'accessoire') then
    return 'accessoires';
  elsif v_norm in ('chaussures', 'chaussure') then
    return 'chaussures';
  elsif v_norm in ('sacs', 'sac', 'maroquinerie') then
    return 'sacs';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC : tenue publiée d'une pièce (fiche item app)
-- ---------------------------------------------------------------------------

create or replace function public.get_item_outfit_look(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_outfit public.item_outfit_looks%rowtype;
  v_companions jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_item_id is null then
    return null;
  end if;

  select *
  into v_outfit
  from public.item_outfit_looks l
  where l.anchor_item_id = p_item_id
    and l.published = true
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_id', c.companion_item_id,
        'role_label', c.role_label,
        'sort_order', c.sort_order
      )
      order by c.sort_order asc, c.created_at asc
    ),
    '[]'::jsonb
  )
  into v_companions
  from public.item_outfit_companion_items c
  where c.outfit_id = v_outfit.id;

  return jsonb_build_object(
    'title', v_outfit.title,
    'intro', v_outfit.intro,
    'companions', coalesce(v_companions, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_item_outfit_look(uuid) to authenticated;

comment on function public.get_item_outfit_look(uuid) is
  'Tenue éditoriale publiée pour une pièce pivot (fiche item app).';

-- ---------------------------------------------------------------------------
-- RPC : suggestions panier / checkout (CMS + fallback complémentaire)
-- ---------------------------------------------------------------------------

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
  v_brand_ids uuid[];
  v_cart_departments text[];
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

  -- Companions CMS (tenues publiées des pièces du panier)
  select coalesce(array_agg(distinct c.companion_item_id), '{}'::uuid[])
  into v_cms_ids
  from public.item_outfit_looks l
  join public.item_outfit_companion_items c on c.outfit_id = l.id
  join public.items ci on ci.id = c.companion_item_id
  where l.published = true
    and l.anchor_item_id = any(v_cart_ids)
    and not (c.companion_item_id = any(v_exclude))
    and ci.deleted_at is null
    and ci.owner_user_id <> v_uid
    and ci.status in (
      'available'::public.item_status,
      'in_cart'::public.item_status
    )
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

  -- Marques du panier (fallback tri)
  select coalesce(array_agg(distinct i.item_brand_id) filter (where i.item_brand_id is not null), '{}'::uuid[])
  into v_brand_ids
  from public.items i
  where i.id = any(v_cart_ids);

  -- Départements déjà couverts par le panier
  select coalesce(array_agg(distinct public.resolve_item_department_slug(i.item_category_id)) filter (
    where public.resolve_item_department_slug(i.item_category_id) is not null
  ), '{}'::text[])
  into v_cart_departments
  from public.items i
  where i.id = any(v_cart_ids);

  with
  candidate_ids as (
    select cid as id, 0 as priority, array_position(v_cms_ids, cid) as cms_ord
    from unnest(v_cms_ids) as cid
    union all
    select i.id, 1 as priority, null::integer as cms_ord
    from public.items i
    where cardinality(v_cms_ids) < v_limit
      and i.deleted_at is null
      and i.owner_user_id <> v_uid
      and not (i.id = any(v_exclude))
      and not (i.id = any(v_cms_ids))
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
        order by
          c.priority asc,
          c.cms_ord asc nulls last,
          case when i.item_brand_id = any(v_brand_ids) then 0 else 1 end,
          i.updated_at desc
      ) as rn
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

grant execute on function public.get_cart_outfit_suggestions(uuid[], uuid[], integer) to authenticated;

comment on function public.get_cart_outfit_suggestions(uuid[], uuid[], integer) is
  'Suggestions upsell panier/checkout : companions CMS des tenues publiées + fallback départements complémentaires.';

-- ---------------------------------------------------------------------------
-- Panier : slot natif cart_system_outfit_suggestions
-- ---------------------------------------------------------------------------

insert into public.cms_app_sections (
  section_key,
  display_title,
  sort_order,
  page_key,
  page_sort_order,
  draft_section_config,
  published_section_config
)
values (
  'cart_system_outfit_suggestions',
  'Panier — Complétez votre tenue',
  7,
  'panier',
  15,
  '{}'::jsonb,
  '{}'::jsonb
)
on conflict (section_key) do update
set
  page_key = excluded.page_key,
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title);

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'panier', 15
from public.cms_app_sections s
where s.section_key = 'cart_system_outfit_suggestions'
on conflict (section_id, page_key) do update
set page_sort_order = excluded.page_sort_order;

update public.cms_app_section_on_page p
set page_sort_order = v.ord
from public.cms_app_sections s
join (
  values
    ('cart_system_items', 10),
    ('cart_system_outfit_suggestions', 15),
    ('cart_offers', 20),
    ('cart_system_exchange', 30)
) as v (k, ord) on s.section_key = v.k
where p.section_id = s.id
  and p.page_key = 'panier';
