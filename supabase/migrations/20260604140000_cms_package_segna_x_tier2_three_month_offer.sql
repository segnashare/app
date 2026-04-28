-- Palier 2 SegnaX : 1 mois offert + 2 mois à 49,99€ (moyenne ~33,33€ / mois), aligné sur le format du palier 6 mois.

update public.cms_app_section_frames f
set
  draft_payload = jsonb_set(
    coalesce(f.draft_payload, '{}'::jsonb),
    '{subscription_offer_tiers,1}',
    jsonb_build_object(
      'badge',
      'Engagement 3 mois',
      'title',
      '3 mois SegnaX',
      'subtitle',
      '1 mois offert, puis 2 mois à 49,99€ / mois',
      'price_line',
      '49,99€ / mois',
      'micro_line',
      'Soit ~33,33€ / mois avec le mois offert.',
      'featured',
      false,
      'checkout_plan_code',
      'segna_x'
    )
  ),
  published_payload = jsonb_set(
    coalesce(f.published_payload, '{}'::jsonb),
    '{subscription_offer_tiers,1}',
    jsonb_build_object(
      'badge',
      'Engagement 3 mois',
      'title',
      '3 mois SegnaX',
      'subtitle',
      '1 mois offert, puis 2 mois à 49,99€ / mois',
      'price_line',
      '49,99€ / mois',
      'micro_line',
      'Soit ~33,33€ / mois avec le mois offert.',
      'featured',
      false,
      'checkout_plan_code',
      'segna_x'
    )
  )
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null
  and jsonb_array_length(coalesce(f.published_payload->'subscription_offer_tiers', '[]'::jsonb)) >= 2;
