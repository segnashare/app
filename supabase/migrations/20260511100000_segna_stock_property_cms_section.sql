-- Section CMS « Propriété Segna » : frames modulables pour toutes les fiches dont le propriétaire est le stock Segna (corporate_inventory).
-- Page « Autre » dans le BO ; l’app charge `segna_stock_property` sur la fiche pièce.
-- Dans les textes des frames : placeholders dynamiques `{{segna_mods}}`, `{{segna_taille}}`.

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
  'segna_stock_property',
  'Autre — Propriété Segna (fiches stock Segna)',
  55,
  'autre',
  20,
  jsonb_build_object(
    'title', 'Propriété Segna',
    'hide_section_title', true
  ),
  jsonb_build_object(
    'title', 'Propriété Segna',
    'hide_section_title', true
  )
)
on conflict (section_key) do nothing;

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'autre', 20
from public.cms_app_sections s
where s.section_key = 'segna_stock_property'
on conflict (section_id, page_key) do update
set
  page_sort_order = excluded.page_sort_order,
  deleted_at = null;
