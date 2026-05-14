-- Bannière visuelle parrainage (même type de frame que le catalogue `shop_link_card`), page BO « Autre ».

insert into public.cms_app_sections (
  section_key,
  display_title,
  sort_order,
  page_key,
  page_sort_order,
  is_section_model,
  draft_section_config,
  published_section_config
)
values (
  'profile_referral_banner',
  'Autre — Profil parrainage (bannière)',
  88,
  'autre',
  26,
  false,
  jsonb_build_object(
    'title', 'Parrainage',
    'hide_section_title', true,
    'default_frame_type', 'shop_link_card',
    'allowed_frame_types', jsonb_build_array('shop_link_card')
  ),
  jsonb_build_object(
    'title', 'Parrainage',
    'hide_section_title', true,
    'default_frame_type', 'shop_link_card',
    'allowed_frame_types', jsonb_build_array('shop_link_card')
  )
)
on conflict (section_key) do update
set
  display_title = excluded.display_title,
  page_key = excluded.page_key,
  page_sort_order = excluded.page_sort_order,
  draft_section_config = excluded.draft_section_config,
  published_section_config = excluded.published_section_config,
  deleted_at = null;

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'autre', 26
from public.cms_app_sections s
where s.section_key = 'profile_referral_banner'
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
  'shop_link_card',
  v.payload,
  v.payload,
  timezone('utc', now())
from public.cms_app_sections s
cross join lateral (
  values (
    jsonb_build_object(
      'title', '',
      'target_url', '/shop',
      'cta_label', '',
      'cta_pill', false,
      'background',
      jsonb_build_object(
        'kind', 'gradient',
        'gradient_classes', 'from-sky-300 via-indigo-200 to-violet-300'
      )
    )
  )
) as v(payload)
where s.section_key = 'profile_referral_banner'
  and not exists (
    select 1
    from public.cms_app_section_frames f
    where f.section_id = s.id
      and f.frame_type = 'shop_link_card'
  );
