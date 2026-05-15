-- Page CMS « Auth » + frames collage d’accueil (8 images), RPC publique pour l’app (anon).
-- Extrait de 20260419120000 : exécuté ici car cms_app_section_on_page, plan_codes, page_key section, etc. existent.

-- ---------------------------------------------------------------------------
-- page_key « auth » sur la table de liaison sections ↔ pages
-- ---------------------------------------------------------------------------

alter table public.cms_app_section_on_page
  drop constraint if exists cms_app_section_on_page_page_key_check;

alter table public.cms_app_section_on_page
  add constraint cms_app_section_on_page_page_key_check check (
    page_key in ('boutique', 'panier', 'echange', 'autre', 'auth')
  );

-- ---------------------------------------------------------------------------
-- Nouveau type de frame : image collage auth (aspect / taille / position)
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
      'auth_collage_image'
    )
  );

-- ---------------------------------------------------------------------------
-- Section + 8 frames publiées (images vides jusqu’à édition BO)
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
  'auth_landing_collage',
  'Auth — Collage d’accueil',
  5,
  'auth',
  0,
  jsonb_build_object(
    'title', 'Collage d’accueil (auth)',
    'hide_section_title', true,
    'default_frame_type', 'auth_collage_image',
    'allowed_frame_types', jsonb_build_array('auth_collage_image')
  ),
  jsonb_build_object(
    'title', 'Collage d’accueil (auth)',
    'hide_section_title', true,
    'default_frame_type', 'auth_collage_image',
    'allowed_frame_types', jsonb_build_array('auth_collage_image')
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
select s.id, 'auth', 0
from public.cms_app_sections s
where s.section_key = 'auth_landing_collage'
on conflict (section_id, page_key) do update
set page_sort_order = excluded.page_sort_order,
    deleted_at = null;

-- Slots prédéfinis (positions %), 8 frames max ; images à renseigner dans le BO.
with section as (
  select id from public.cms_app_sections where section_key = 'auth_landing_collage' limit 1
),
slots (sort_order, payload) as (
  values
    (0, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'square',
      'collage_size', 'small',
      'collage_top_pct', 6,
      'collage_left_pct', 4,
      'collage_float_delay_ms', 0
    )),
    (1, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'portrait',
      'collage_size', 'medium',
      'collage_top_pct', 10,
      'collage_left_pct', 70,
      'collage_float_delay_ms', 400
    )),
    (2, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'landscape',
      'collage_size', 'large',
      'collage_top_pct', 20,
      'collage_left_pct', 12,
      'collage_float_delay_ms', 200
    )),
    (3, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'square',
      'collage_size', 'medium',
      'collage_top_pct', 36,
      'collage_left_pct', 72,
      'collage_float_delay_ms', 600
    )),
    (4, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'portrait',
      'collage_size', 'small',
      'collage_top_pct', 48,
      'collage_left_pct', 6,
      'collage_float_delay_ms', 100
    )),
    (5, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'landscape',
      'collage_size', 'small',
      'collage_top_pct', 56,
      'collage_left_pct', 42,
      'collage_float_delay_ms', 500
    )),
    (6, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'square',
      'collage_size', 'large',
      'collage_top_pct', 68,
      'collage_left_pct', 14,
      'collage_float_delay_ms', 300
    )),
    (7, jsonb_build_object(
      'collage_image', jsonb_build_object('storage_path', ''),
      'collage_aspect', 'portrait',
      'collage_size', 'medium',
      'collage_top_pct', 74,
      'collage_left_pct', 64,
      'collage_float_delay_ms', 700
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
  section.id,
  slots.sort_order,
  'guest',
  array['guest', 'segna_plus', 'segna_x']::text[],
  'auth_collage_image',
  slots.payload,
  slots.payload,
  now()
from section
cross join slots
where not exists (
  select 1
  from public.cms_app_section_frames f
  where f.section_id = section.id
);

-- ---------------------------------------------------------------------------
-- RPC publique : collage auth (sans session requise)
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_auth_landing_frames()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', f.plan_code,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  from public.cms_app_section_frames f
  join public.cms_app_sections s on s.id = f.section_id
  where s.section_key = 'auth_landing_collage'
    and s.deleted_at is null
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';
$$;

grant execute on function public.get_cms_auth_landing_frames() to anon;
grant execute on function public.get_cms_auth_landing_frames() to authenticated;

comment on function public.get_cms_auth_landing_frames() is
  'Frames publiées du collage d’accueil /auth (lecture publique, URLs signées côté app).';
