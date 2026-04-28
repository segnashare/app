-- Page abonnement SegnaX (/package?plan=x) : section CMS + type de frame dédié (contenu modulaire).

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
      'subscription_plan_landing'
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
  'package_segna_x',
  'Abonnement — Page SegnaX (/package?plan=x)',
  960,
  'autre',
  5,
  jsonb_build_object(
    'default_frame_type', 'subscription_plan_landing',
    'allowed_frame_types', jsonb_build_array('subscription_plan_landing')
  ),
  jsonb_build_object(
    'default_frame_type', 'subscription_plan_landing',
    'allowed_frame_types', jsonb_build_array('subscription_plan_landing')
  )
)
on conflict (section_key) do update
set
  display_title = excluded.display_title,
  page_key = excluded.page_key,
  page_sort_order = excluded.page_sort_order,
  draft_section_config = excluded.draft_section_config,
  published_section_config = excluded.published_section_config;

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'autre', 5
from public.cms_app_sections s
where s.section_key = 'package_segna_x'
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
  array['guest']::text[],
  'subscription_plan_landing',
  v.payload,
  v.payload,
  timezone('utc', now())
from public.cms_app_sections s
cross join lateral (
  values (
    jsonb_build_object(
      'subscription_header_wordmark', 'SegnaX',
      'subscription_page_title', 'Devenez membre segna X',
      'subscription_cta_label', 'Passer à l’abonnement',
      'subscription_footnote',
      '* La capacité d’emprunt dépend des conditions du plan. Paiement à la confirmation ; renouvellement automatique sauf annulation avant l’échéance.',
      'subscription_checkout_plan_code', 'segna_x',
      'subscription_offer_tiers',
      jsonb_build_array(
        jsonb_build_object(
          'badge', 'Nouveau',
          'title', '49,99€ / mois',
          'subtitle', 'Sans engagement.',
          'featured', false,
          'checkout_plan_code', 'segna_x'
        ),
        jsonb_build_object(
          'badge', 'Économisez ~15%',
          'subtitle', '3 mois à ~42,50€ / mois',
          'featured', false,
          'checkout_plan_code', 'segna_x'
        ),
        jsonb_build_object(
          'badge', 'Économisez ~25%',
          'title', '6 mois SegnaX',
          'subtitle', '1er mois offert, puis 5 mois à tarif réduit',
          'price_line', '44,99€ / mois',
          'micro_line', 'Soit ~37,49€ / mois avec le mois offert.',
          'featured', true,
          'checkout_plan_code', 'segna_x'
        )
      ),
      'subscription_value_props',
      jsonb_build_array(
        jsonb_build_object(
          'title', 'Plus de pièces',
          'body', 'Tu as 2 échanges inclus par mois, avec jusqu’à 5 pièces par échange.'
        ),
        jsonb_build_object(
          'title', 'Plus de style',
          'body', 'Tu reçois 500 crédits de consommation à utiliser sur les pièces qui te plaisent le plus.'
        ),
        jsonb_build_object(
          'title', 'Plus de liberté',
          'body', 'Tu es couverte par l’assurance Segna sur les échanges, selon nos conditions.'
        )
      )
    )
  )
) as v(payload)
where s.section_key = 'package_segna_x'
  and not exists (
    select 1
    from public.cms_app_section_frames f
    where f.section_id = s.id
      and f.frame_type = 'subscription_plan_landing'
  );
