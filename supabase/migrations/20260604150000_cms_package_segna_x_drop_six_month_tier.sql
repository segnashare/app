-- Retrait du palier « 6 mois SegnaX » (3e entrée) sur la landing /package?plan=x.

update public.cms_app_section_frames f
set
  draft_payload = case
    when jsonb_array_length(coalesce(f.draft_payload->'subscription_offer_tiers', '[]'::jsonb)) >= 3
    then jsonb_set(
      coalesce(f.draft_payload, '{}'::jsonb),
      '{subscription_offer_tiers}',
      jsonb_build_array(
        f.draft_payload->'subscription_offer_tiers'->0,
        f.draft_payload->'subscription_offer_tiers'->1
      )
    )
    else f.draft_payload
  end,
  published_payload = case
    when jsonb_array_length(coalesce(f.published_payload->'subscription_offer_tiers', '[]'::jsonb)) >= 3
    then jsonb_set(
      coalesce(f.published_payload, '{}'::jsonb),
      '{subscription_offer_tiers}',
      jsonb_build_array(
        f.published_payload->'subscription_offer_tiers'->0,
        f.published_payload->'subscription_offer_tiers'->1
      )
    )
    else f.published_payload
  end
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null;
