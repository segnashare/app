-- SegnaX : nouvelles propositions de valeur + suppression crédits / intro (non affichés).

update public.cms_app_section_frames f
set
  draft_payload = (
    coalesce(f.draft_payload, '{}'::jsonb)
    || jsonb_build_object(
      'subscription_value_props',
      jsonb_build_array(
        jsonb_build_object(
          'title',
          'Plus de pièces',
          'body',
          'Tu as 2 échanges inclus par mois, avec jusqu’à 5 pièces par échange.'
        ),
        jsonb_build_object(
          'title',
          'Plus de style',
          'body',
          'Tu reçois 500 crédits de consommation à utiliser sur les pièces qui te plaisent le plus.'
        ),
        jsonb_build_object(
          'title',
          'Plus de liberté',
          'body',
          'Tu es couverte par l’assurance Segna sur les échanges, selon nos conditions.'
        )
      )
    )
  )
    - 'subscription_credits_line'
    - 'subscription_intro_body',
  published_payload = (
    coalesce(f.published_payload, '{}'::jsonb)
    || jsonb_build_object(
      'subscription_value_props',
      jsonb_build_array(
        jsonb_build_object(
          'title',
          'Plus de pièces',
          'body',
          'Tu as 2 échanges inclus par mois, avec jusqu’à 5 pièces par échange.'
        ),
        jsonb_build_object(
          'title',
          'Plus de style',
          'body',
          'Tu reçois 500 crédits de consommation à utiliser sur les pièces qui te plaisent le plus.'
        ),
        jsonb_build_object(
          'title',
          'Plus de liberté',
          'body',
          'Tu es couverte par l’assurance Segna sur les échanges, selon nos conditions.'
        )
      )
    )
  )
    - 'subscription_credits_line'
    - 'subscription_intro_body'
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null;
