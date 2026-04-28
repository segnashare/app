-- Hero « Mon profil » : même type de frame que « Obtenir plus » (`profile_plus_hero`), éditable dans le BO (page Autre).

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
  'profile_me_tab',
  'Autre — Profil Mon profil (hero)',
  45,
  'autre',
  25,
  jsonb_build_object(
    'title', 'Mon profil',
    'hide_section_title', true,
    'default_frame_type', 'profile_plus_hero',
    'allowed_frame_types', jsonb_build_array('profile_plus_hero')
  ),
  jsonb_build_object(
    'title', 'Mon profil',
    'hide_section_title', true,
    'default_frame_type', 'profile_plus_hero',
    'allowed_frame_types', jsonb_build_array('profile_plus_hero')
  )
)
on conflict (section_key) do update
set
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title),
  page_key = excluded.page_key,
  page_sort_order = excluded.page_sort_order,
  draft_section_config = excluded.draft_section_config,
  published_section_config = excluded.published_section_config;

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'autre', 25
from public.cms_app_sections s
where s.section_key = 'profile_me_tab'
on conflict (section_id, page_key) do update
set
  page_sort_order = excluded.page_sort_order,
  deleted_at = null;

insert into public.cms_app_section_frames (
  section_id,
  sort_order,
  plan_codes,
  frame_type,
  draft_payload,
  published_payload,
  published_at
)
select
  s.id,
  0,
  array['guest', 'segna_plus', 'segna_x']::text[],
  'profile_plus_hero',
  v.payload,
  v.payload,
  timezone('utc', now())
from public.cms_app_sections s
cross join lateral (
  values (
    jsonb_build_object(
      'label', '',
      'title', 'Ton profil',
      'subtitle',
      'Mets à jour tes informations à tout moment pour qu''elles restent fidèles à ta réalité.',
      'cta_label', 'Modifie ton profil',
      'target_url', '/profile/complete?tab=me',
      'background',
      jsonb_build_object(
        'kind', 'solid',
        'solid_hex', '#27272a'
      )
    )
  )
) as v(payload)
where s.section_key = 'profile_me_tab'
  and not exists (
    select 1
    from public.cms_app_section_frames f
    where f.section_id = s.id
      and f.frame_type = 'profile_plus_hero'
  );
