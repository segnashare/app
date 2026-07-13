-- Accueil : hero plein écran modulable (image, logo, titre, lien) — type de frame dédié.

alter table public.cms_app_section_frames
  drop constraint if exists cms_app_section_frames_type_check;

alter table public.cms_app_section_frames
  add constraint cms_app_section_frames_type_check check (
    frame_type in (
      'offer_card',
      'category_capsule',
      'promo_ad',
      'editorial_card',
      'shop_item_ref',
      'shop_category_ref',
      'shop_brand_ref',
      'shop_link_card',
      'profile_plus_hero',
      'auth_collage_image',
      'onboarding_stack_image',
      'subscription_plan_landing',
      'home_hero'
    )
  );

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
  'home_system_hero',
  'Accueil — Hero plein écran',
  3,
  'home',
  5,
  jsonb_build_object(
    'title', 'Hero',
    'hide_section_title', true,
    'show_more_arrow', false,
    'more_href', '',
    'default_frame_type', 'home_hero',
    'allowed_frame_types', jsonb_build_array('home_hero')
  ),
  jsonb_build_object(
    'title', 'Hero',
    'hide_section_title', true,
    'show_more_arrow', false,
    'more_href', '',
    'default_frame_type', 'home_hero',
    'allowed_frame_types', jsonb_build_array('home_hero')
  )
)
on conflict (section_key) do update
set
  page_key = excluded.page_key,
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title),
  draft_section_config = excluded.draft_section_config,
  published_section_config = excluded.published_section_config;

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'home', 5
from public.cms_app_sections s
where s.section_key = 'home_system_hero'
on conflict (section_id, page_key) do update
set
  page_sort_order = excluded.page_sort_order,
  deleted_at = null;
