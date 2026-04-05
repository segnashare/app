-- Blocs « catalogue » non-CMS modélisés comme sections pour le drag & drop BO + ordre boutique côté app.

-- ---------------------------------------------------------------------------
-- Lignes sentinelles (titres éditables en BO ; pas de frames CMS)
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
values
  (
    'shop_system_liked',
    'Bloc catalogue — Pièces likées',
    200,
    'boutique',
    20,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'shop_system_for_you',
    'Bloc catalogue — Susceptibles de vous plaire',
    210,
    'boutique',
    40,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'shop_system_popular',
    'Bloc catalogue — Les plus likées',
    220,
    'boutique',
    50,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'shop_system_lenders',
    'Bloc catalogue — Nos supers prêteuses',
    230,
    'boutique',
    90,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'shop_system_available',
    'Bloc catalogue — Grille Disponibles',
    240,
    'boutique',
    110,
    '{}'::jsonb,
    '{}'::jsonb
  )
on conflict (section_key) do update
set
  page_key = excluded.page_key,
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title);

-- Ordre par défaut aligné sur l’ancienne maquette boutique (une seule fois à l’application de la migration)
update public.cms_app_sections
set page_sort_order = case section_key
  when 'shop_section_discover' then 10
  when 'shop_system_liked' then 20
  when 'shop_section_categories' then 30
  when 'shop_system_for_you' then 40
  when 'shop_system_popular' then 50
  when 'shop_section_preferred_brands' then 60
  when 'shop_home_capsules' then 70
  when 'shop_section_deals' then 80
  when 'shop_system_lenders' then 90
  when 'shop_section_french' then 100
  when 'shop_system_available' then 110
  else page_sort_order
end
where page_key = 'boutique';

-- ---------------------------------------------------------------------------
-- RPC : ordre des section_key pour la page boutique (authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_boutique_section_order()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(s.section_key order by s.page_sort_order asc, s.section_key asc),
    '[]'::jsonb
  )
  from public.cms_app_sections s
  where s.page_key = 'boutique';
$$;

grant execute on function public.get_cms_boutique_section_order() to authenticated;

comment on function public.get_cms_boutique_section_order() is
  'Liste ordonnée des section_key (page boutique) pour le rendu hub /shop.';
