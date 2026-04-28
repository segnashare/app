-- Palier « 3 mois SegnaX » : 30 jours d’essai Stripe (= 1er mois offert facturation).

update public.cms_app_section_frames f
set
  draft_payload = jsonb_set(
    coalesce(f.draft_payload, '{}'::jsonb),
    '{subscription_offer_tiers,1,trial_period_days}',
    '30'::jsonb,
    true
  ),
  published_payload = jsonb_set(
    coalesce(f.published_payload, '{}'::jsonb),
    '{subscription_offer_tiers,1,trial_period_days}',
    '30'::jsonb,
    true
  )
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null
  and jsonb_array_length(coalesce(f.draft_payload->'subscription_offer_tiers', '[]'::jsonb)) >= 2
  and jsonb_array_length(coalesce(f.published_payload->'subscription_offer_tiers', '[]'::jsonb)) >= 2;
