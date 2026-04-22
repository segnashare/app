-- Page CMS « onboarding » + 3 sections intro (3 images stack / étape), type frame dédié (sans animation côté app).

-- ---------------------------------------------------------------------------
-- page_key : réintroduit « auth » si absent + ajoute « onboarding »
-- ---------------------------------------------------------------------------

alter table public.cms_app_section_on_page
  drop constraint if exists cms_app_section_on_page_page_key_check;

alter table public.cms_app_section_on_page
  add constraint cms_app_section_on_page_page_key_check check (
    page_key in ('boutique', 'panier', 'echange', 'autre', 'auth', 'onboarding')
  );

-- ---------------------------------------------------------------------------
-- Nouveau type de frame : pile visuelle onboarding (même payload collage que /auth)
-- ---------------------------------------------------------------------------

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
      'onboarding_stack_image'
    )
  );

-- ---------------------------------------------------------------------------
-- Sections onboarding_1_intro, onboarding_2_intro, onboarding_3_intro
-- + liaison page « onboarding » + 3 frames publiées chacune (images vides)
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
    'onboarding_1_intro',
    'Onboarding — Étape 1 (visuel)',
    100,
    'onboarding',
    10,
    jsonb_build_object(
      'title', 'Onboarding — Étape 1 (visuel)',
      'hide_section_title', true,
      'default_frame_type', 'onboarding_stack_image',
      'allowed_frame_types', jsonb_build_array('onboarding_stack_image')
    ),
    jsonb_build_object(
      'title', 'Onboarding — Étape 1 (visuel)',
      'hide_section_title', true,
      'default_frame_type', 'onboarding_stack_image',
      'allowed_frame_types', jsonb_build_array('onboarding_stack_image')
    )
  ),
  (
    'onboarding_2_intro',
    'Onboarding — Étape 2 (visuel)',
    101,
    'onboarding',
    20,
    jsonb_build_object(
      'title', 'Onboarding — Étape 2 (visuel)',
      'hide_section_title', true,
      'default_frame_type', 'onboarding_stack_image',
      'allowed_frame_types', jsonb_build_array('onboarding_stack_image')
    ),
    jsonb_build_object(
      'title', 'Onboarding — Étape 2 (visuel)',
      'hide_section_title', true,
      'default_frame_type', 'onboarding_stack_image',
      'allowed_frame_types', jsonb_build_array('onboarding_stack_image')
    )
  ),
  (
    'onboarding_3_intro',
    'Onboarding — Étape 3 (visuel)',
    102,
    'onboarding',
    30,
    jsonb_build_object(
      'title', 'Onboarding — Étape 3 (visuel)',
      'hide_section_title', true,
      'default_frame_type', 'onboarding_stack_image',
      'allowed_frame_types', jsonb_build_array('onboarding_stack_image')
    ),
    jsonb_build_object(
      'title', 'Onboarding — Étape 3 (visuel)',
      'hide_section_title', true,
      'default_frame_type', 'onboarding_stack_image',
      'allowed_frame_types', jsonb_build_array('onboarding_stack_image')
    )
  )
on conflict (section_key) do update
set
  display_title = excluded.display_title,
  page_key = excluded.page_key,
  page_sort_order = excluded.page_sort_order,
  draft_section_config = excluded.draft_section_config,
  published_section_config = excluded.published_section_config,
  updated_at = now();

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'onboarding', v.ord
from (values
  ('onboarding_1_intro', 10),
  ('onboarding_2_intro', 20),
  ('onboarding_3_intro', 30)
) as v(key, ord)
join public.cms_app_sections s on s.section_key = v.key
on conflict (section_id, page_key) do update
set page_sort_order = excluded.page_sort_order,
    deleted_at = null;

-- 3 frames par section (tri vertical dans l’app), collage_float_delay_ms = 0
with section as (
  select id, section_key from public.cms_app_sections
  where section_key in ('onboarding_1_intro', 'onboarding_2_intro', 'onboarding_3_intro')
),
slot_templates (sort_order, payload) as (
  values
    (0, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'portrait',
      'collage_size', 'medium',
      'collage_top_pct', 50,
      'collage_left_pct', 50,
      'collage_float_delay_ms', 0
    )),
    (1, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'portrait',
      'collage_size', 'small',
      'collage_top_pct', 50,
      'collage_left_pct', 50,
      'collage_float_delay_ms', 0
    )),
    (2, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'square',
      'collage_size', 'medium',
      'collage_top_pct', 50,
      'collage_left_pct', 50,
      'collage_float_delay_ms', 0
    ))
)
insert into public.cms_app_section_frames (
  section_id,
  sort_order,
  plan_code,
  plan_codes,
  frame_type,
  draft_payload,
  published_payload,
  published_at
)
select
  s.id,
  sp.sort_order,
  'guest',
  array['guest', 'segna_plus', 'segna_x']::text[],
  'onboarding_stack_image',
  sp.payload,
  sp.payload,
  now()
from section s
cross join slot_templates sp
where not exists (
  select 1
  from public.cms_app_section_frames f
  where f.section_id = s.id
);

comment on column public.cms_app_section_frames.frame_type is
  'Inclut onboarding_stack_image : pile visuelle onboarding (payload type collage auth, sans animation flottement côté app si délai 0).';
