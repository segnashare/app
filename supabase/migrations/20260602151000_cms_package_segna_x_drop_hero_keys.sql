-- Retrait des clés hero obsolètes du payload SegnaX (l’UI n’affiche plus Share / image).

update public.cms_app_section_frames f
set
  draft_payload = coalesce(f.draft_payload, '{}'::jsonb) - 'subscription_hero_title' - 'subscription_hero_image',
  published_payload = coalesce(f.published_payload, '{}'::jsonb) - 'subscription_hero_title' - 'subscription_hero_image'
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null;
