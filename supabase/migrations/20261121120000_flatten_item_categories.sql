-- Catégories catalogue plates (plus de parenting), alignées sur le nav :
-- Robes, Hauts, Vestes & gilets, Manteaux, Jupes, Pantalons, Ensembles, Shorts, Accessoires, Archivistes.

alter table public.item_categories
  add column if not exists sort_order integer not null default 0;

create or replace function public._flatten_norm_cat_label(p_label text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    lower(translate(
      coalesce(p_label, ''),
      'àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ',
      'aaaeeeeiioouuuycaaaeeeeiioouuuyc'
    )),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
$$;

create or replace function public._flatten_target_key(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v text := public._flatten_norm_cat_label(p_name);
begin
  if v ~ '(jean court|shorts|pantacourt|combi short)' then
    return 'shorts';
  elsif v ~ '(^| )jupe' then
    return 'jupes';
  elsif v ~ '(^| )robe' then
    return 'robes';
  elsif v ~ '(manteau|trench|parka|duffle|cape|poncho|impermeable|pardessus|caban)' then
    return 'manteaux';
  elsif v ~ '(veste|gilet|blazer|blouson|doudoune|perfecto|teddy)' then
    return 'vestes_gilets';
  elsif v ~ '(ensemble|combinaison|(^| )combi(s| |$)|tailleur|costume|survetement)' then
    return 'ensembles';
  elsif v ~ '(pantalon|jean|legging|sarouel|chino)' then
    return 'pantalons';
  elsif v ~ '(haut|tshirt|tee shirt|blouse|chemise|(^| )top|body|debardeur|pull|sweat|cardigan|tunique|col roule|peplum)' then
    return 'hauts';
  elsif v ~ '(accessoire|sacs|sac |chaussure|botte|basket|sandale|mule|escarpin|bijou|ceinture|chapeau|casquette|echarpe|foulard|gant|lunette|montre|pochette|ballerine|mocassin|tong|claquette|babie|mary jane|espadrille|besace|bandouliere)' then
    return 'accessoires';
  elsif v ~ 'vetement' then
    return 'hauts';
  end if;
  return null;
end;
$$;

do $$
declare
  v_robes uuid;
  v_hauts uuid;
  v_vestes uuid;
  v_manteaux uuid;
  v_jupes uuid;
  v_pantalons uuid;
  v_ensembles uuid;
  v_shorts uuid;
  v_accessoires uuid;
  v_archivistes uuid;
begin
  select id into v_robes from public.item_categories where name = 'Robes' limit 1;
  select id into v_vestes from public.item_categories where name in ('Vestes', 'Vestes & gilets') order by case when name = 'Vestes & gilets' then 0 else 1 end limit 1;
  select id into v_manteaux from public.item_categories where name = 'Manteaux' limit 1;
  select id into v_jupes from public.item_categories where name = 'Jupes' limit 1;
  select id into v_pantalons from public.item_categories where name in ('Pantalons', 'Pantalons et leggings') order by case when name = 'Pantalons' then 0 else 1 end limit 1;
  select id into v_shorts from public.item_categories where name = 'Shorts' limit 1;
  select id into v_accessoires from public.item_categories where name = 'Accessoires' limit 1;
  select id into v_hauts from public.item_categories where name = 'Hauts' limit 1;
  select id into v_ensembles from public.item_categories where name = 'Ensembles' limit 1;
  select id into v_archivistes from public.item_categories where name = 'Archivistes' limit 1;

  if v_robes is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Robes', 'tmp-robes-' || gen_random_uuid()::text, 'top') returning id into v_robes;
  end if;
  if v_hauts is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Hauts', 'tmp-hauts-' || gen_random_uuid()::text, 'top') returning id into v_hauts;
  end if;
  if v_vestes is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Vestes & gilets', 'tmp-vestes-' || gen_random_uuid()::text, 'top') returning id into v_vestes;
  end if;
  if v_manteaux is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Manteaux', 'tmp-manteaux-' || gen_random_uuid()::text, 'top') returning id into v_manteaux;
  end if;
  if v_jupes is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Jupes', 'tmp-jupes-' || gen_random_uuid()::text, 'bottom') returning id into v_jupes;
  end if;
  if v_pantalons is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Pantalons', 'tmp-pantalons-' || gen_random_uuid()::text, 'bottom') returning id into v_pantalons;
  end if;
  if v_ensembles is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Ensembles', 'tmp-ensembles-' || gen_random_uuid()::text, 'top') returning id into v_ensembles;
  end if;
  if v_shorts is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Shorts', 'tmp-shorts-' || gen_random_uuid()::text, 'bottom') returning id into v_shorts;
  end if;
  if v_accessoires is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Accessoires', 'tmp-accessoires-' || gen_random_uuid()::text, 'none') returning id into v_accessoires;
  end if;
  if v_archivistes is null then
    insert into public.item_categories (name, slug, size_scope)
    values ('Archivistes', 'tmp-archivistes-' || gen_random_uuid()::text, 'top') returning id into v_archivistes;
  end if;

  update public.item_categories set name = 'Vestes & gilets' where id = v_vestes;
  update public.item_categories set name = 'Pantalons' where id = v_pantalons;

  create temporary table tmp_cat_target (
    cat_id uuid primary key,
    target_key text not null
  ) on commit drop;

  insert into tmp_cat_target (cat_id, target_key)
  select picked.cat_id, picked.target_key
  from (
    select
      chain.cat_id,
      public._flatten_target_key(chain.node_name) as target_key,
      row_number() over (
        partition by chain.cat_id
        order by chain.dist
      ) as rn
    from (
      with recursive chain as (
        select
          c.id as cat_id,
          c.id as node_id,
          c.parent_category_id,
          c.name as node_name,
          0 as dist
        from public.item_categories c
        union all
        select
          chain.cat_id,
          p.id,
          p.parent_category_id,
          p.name,
          chain.dist + 1
        from chain
        join public.item_categories p on p.id = chain.parent_category_id
      )
      select * from chain
    ) chain
    where public._flatten_target_key(chain.node_name) is not null
  ) picked
  where picked.rn = 1;

  insert into tmp_cat_target (cat_id, target_key)
  select c.id, 'hauts'
  from public.item_categories c
  where not exists (select 1 from tmp_cat_target t where t.cat_id = c.id)
    and c.id not in (v_archivistes);

  create temporary table tmp_canonical (
    target_key text primary key,
    id uuid not null
  ) on commit drop;

  insert into tmp_canonical (target_key, id) values
    ('robes', v_robes),
    ('hauts', v_hauts),
    ('vestes_gilets', v_vestes),
    ('manteaux', v_manteaux),
    ('jupes', v_jupes),
    ('pantalons', v_pantalons),
    ('ensembles', v_ensembles),
    ('shorts', v_shorts),
    ('accessoires', v_accessoires),
    ('archivistes', v_archivistes);

  update public.items i
  set item_category_id = c.id,
      updated_at = now()
  from tmp_cat_target t
  join tmp_canonical c on c.target_key = t.target_key
  where i.item_category_id = t.cat_id
    and i.item_category_id is distinct from c.id;

  insert into public.ai_fashion_model_categories (model_id, category_id)
  select distinct m.model_id, can.id
  from public.ai_fashion_model_categories m
  join tmp_cat_target t on t.cat_id = m.category_id
  join tmp_canonical can on can.target_key = t.target_key
  on conflict (model_id, category_id) do nothing;

  update public.item_categories set parent_category_id = null;

  delete from public.item_categories
  where id not in (
    v_robes, v_hauts, v_vestes, v_manteaux, v_jupes,
    v_pantalons, v_ensembles, v_shorts, v_accessoires, v_archivistes
  );

  update public.item_categories set
    slug = 'tmp-' || id::text
  where id in (
    v_robes, v_hauts, v_vestes, v_manteaux, v_jupes,
    v_pantalons, v_ensembles, v_shorts, v_accessoires, v_archivistes
  );

  update public.item_categories set name = 'Robes', slug = 'robes', size_scope = 'top', sort_order = 10, updated_at = now() where id = v_robes;
  update public.item_categories set name = 'Hauts', slug = 'hauts', size_scope = 'top', sort_order = 20, updated_at = now() where id = v_hauts;
  update public.item_categories set name = 'Vestes & gilets', slug = 'vestes-gilets', size_scope = 'top', sort_order = 30, updated_at = now() where id = v_vestes;
  update public.item_categories set name = 'Manteaux', slug = 'manteaux', size_scope = 'top', sort_order = 40, updated_at = now() where id = v_manteaux;
  update public.item_categories set name = 'Jupes', slug = 'jupes', size_scope = 'bottom', sort_order = 50, updated_at = now() where id = v_jupes;
  update public.item_categories set name = 'Pantalons', slug = 'pantalons', size_scope = 'bottom', sort_order = 60, updated_at = now() where id = v_pantalons;
  update public.item_categories set name = 'Ensembles', slug = 'ensembles', size_scope = 'top', sort_order = 70, updated_at = now() where id = v_ensembles;
  update public.item_categories set name = 'Shorts', slug = 'shorts', size_scope = 'bottom', sort_order = 80, updated_at = now() where id = v_shorts;
  update public.item_categories set name = 'Accessoires', slug = 'accessoires', size_scope = 'none', sort_order = 90, updated_at = now() where id = v_accessoires;
  update public.item_categories set name = 'Archivistes', slug = 'archivistes', size_scope = 'top', sort_order = 100, updated_at = now() where id = v_archivistes;
end;
$$;

drop function if exists public._flatten_target_key(text);
drop function if exists public._flatten_norm_cat_label(text);

alter table public.item_categories
  drop constraint if exists item_categories_parent_category_id_fkey;

drop index if exists item_categories_parent_category_id_idx;

alter table public.item_categories
  drop column if exists parent_category_id;

create or replace function public.get_shop_boutique_filter_facets()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_categories jsonb;
  v_sizes jsonb;
  v_brands jsonb;
  v_colors jsonb;
  v_materials jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(q) order by q.sort_order, q.name), '[]'::jsonb)
  into v_categories
  from (
    select id, name, sort_order
    from public.item_categories
    order by sort_order asc, name asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_sizes
  from (
    select id, label
    from public.sizes
    order by label asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_brands
  from (
    select id, label
    from public.item_brands
    order by label asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_colors
  from (
    select id, label
    from public.item_couleurs
    order by label asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_materials
  from (
    select id, label
    from public.item_materiaux
    order by label asc nulls last
  ) q;

  return jsonb_build_object(
    'categories', v_categories,
    'sizes', v_sizes,
    'brands', v_brands,
    'colors', v_colors,
    'materials', v_materials
  );
end;
$$;

comment on function public.get_shop_boutique_filter_facets() is
  'Boutique : facettes filtres (catégories plates, tailles, marques, couleurs, matériaux).';

revoke all on function public.get_shop_boutique_filter_facets() from public;
grant execute on function public.get_shop_boutique_filter_facets() to authenticated;
grant execute on function public.get_shop_boutique_filter_facets() to service_role;

create or replace function public.resolve_item_department_slug(p_category_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_slug text;
begin
  if p_category_id is null then
    return null;
  end if;

  select c.slug into v_slug
  from public.item_categories c
  where c.id = p_category_id;

  if v_slug is null then
    return null;
  end if;

  if v_slug in ('accessoires') then
    return 'accessoires';
  end if;

  -- Tenues / looks : tout le vestiaire hors accessoires reste « vêtements ».
  return 'vetements';
end;
$$;

comment on table public.item_categories is
  'Catégories catalogue plates (Robes, Hauts, Vestes & gilets, Manteaux, Jupes, Pantalons, Ensembles, Shorts, Accessoires, Archivistes).';
