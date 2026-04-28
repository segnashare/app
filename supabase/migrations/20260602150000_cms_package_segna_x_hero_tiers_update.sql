-- SegnaX /package?plan=x : 3 paliers en scroll + titre écran membre (sans hero).

update public.cms_app_section_frames f
set
  draft_payload =
    coalesce(f.draft_payload, '{}'::jsonb)
    || jsonb_build_object(
      'subscription_page_title',
      'Devenez membre segna X',
      'subscription_offer_tiers',
      jsonb_build_array(
        jsonb_build_object(
          'badge',
          'Nouveau',
          'title',
          '49,99€ / mois',
          'subtitle',
          'Sans engagement.',
          'featured',
          false,
          'checkout_plan_code',
          'segna_x'
        ),
        jsonb_build_object(
          'badge',
          'Économisez ~15%',
          'subtitle',
          '3 mois à ~42,50€ / mois',
          'featured',
          false,
          'checkout_plan_code',
          'segna_x'
        ),
        jsonb_build_object(
          'badge',
          'Économisez ~25%',
          'title',
          '6 mois SegnaX',
          'subtitle',
          '1er mois offert, puis 5 mois à tarif réduit',
          'price_line',
          '44,99€ / mois',
          'micro_line',
          'Soit ~37,49€ / mois avec le mois offert.',
          'featured',
          true,
          'checkout_plan_code',
          'segna_x'
        )
      )
    ),
  published_payload =
    coalesce(f.published_payload, '{}'::jsonb)
    || jsonb_build_object(
      'subscription_page_title',
      'Devenez membre segna X',
      'subscription_offer_tiers',
      jsonb_build_array(
        jsonb_build_object(
          'badge',
          'Nouveau',
          'title',
          '49,99€ / mois',
          'subtitle',
          'Sans engagement.',
          'featured',
          false,
          'checkout_plan_code',
          'segna_x'
        ),
        jsonb_build_object(
          'badge',
          'Économisez ~15%',
          'subtitle',
          '3 mois à ~42,50€ / mois',
          'featured',
          false,
          'checkout_plan_code',
          'segna_x'
        ),
        jsonb_build_object(
          'badge',
          'Économisez ~25%',
          'title',
          '6 mois SegnaX',
          'subtitle',
          '1er mois offert, puis 5 mois à tarif réduit',
          'price_line',
          '44,99€ / mois',
          'micro_line',
          'Soit ~37,49€ / mois avec le mois offert.',
          'featured',
          true,
          'checkout_plan_code',
          'segna_x'
        )
      )
    )
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null;
