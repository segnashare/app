-- Quatrième vignette pour la grille 2×2 de l’intro onboarding étape 2 (CMS).
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
  3,
  'guest',
  array['guest', 'segna_plus', 'segna_x']::text[],
  'onboarding_stack_image',
  jsonb_build_object(
    'title', 'À toi de jouer',
    'subtitle', 'Personnalise',
    'collage_image', jsonb_build_object('storage_path', ''),
    'collage_aspect', 'square',
    'collage_size', 'medium',
    'collage_top_pct', 50,
    'collage_left_pct', 50,
    'collage_float_delay_ms', 0
  ),
  jsonb_build_object(
    'title', 'À toi de jouer',
    'subtitle', 'Personnalise',
    'collage_image', jsonb_build_object('storage_path', ''),
    'collage_aspect', 'square',
    'collage_size', 'medium',
    'collage_top_pct', 50,
    'collage_left_pct', 50,
    'collage_float_delay_ms', 0
  ),
  now()
from public.cms_app_sections s
where s.section_key = 'onboarding_2_intro'
  and not exists (
    select 1
    from public.cms_app_section_frames f
    where f.section_id = s.id
      and f.sort_order = 3
  );
