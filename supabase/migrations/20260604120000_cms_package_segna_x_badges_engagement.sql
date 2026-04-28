-- Remplace les badges « Économisez ~…% » par des libellés d’engagement factuels (abonnement uniquement).

update public.cms_app_section_frames f
set
  draft_payload = jsonb_set(
    coalesce(f.draft_payload, '{}'::jsonb),
    '{subscription_offer_tiers}',
    coalesce(
      (
        select jsonb_agg(
          case
            when (elem->>'badge') = 'Économisez ~15%' then elem || jsonb_build_object('badge', 'Engagement 3 mois')
            when (elem->>'badge') = 'Économisez ~25%' then elem || jsonb_build_object('badge', 'Engagement 6 mois')
            else elem
          end
          order by ord
        )
        from jsonb_array_elements(coalesce(f.draft_payload->'subscription_offer_tiers', '[]'::jsonb))
          with ordinality as t(elem, ord)
      ),
      '[]'::jsonb
    )
  ),
  published_payload = jsonb_set(
    coalesce(f.published_payload, '{}'::jsonb),
    '{subscription_offer_tiers}',
    coalesce(
      (
        select jsonb_agg(
          case
            when (elem->>'badge') = 'Économisez ~15%' then elem || jsonb_build_object('badge', 'Engagement 3 mois')
            when (elem->>'badge') = 'Économisez ~25%' then elem || jsonb_build_object('badge', 'Engagement 6 mois')
            else elem
          end
          order by ord
        )
        from jsonb_array_elements(coalesce(f.published_payload->'subscription_offer_tiers', '[]'::jsonb))
          with ordinality as t(elem, ord)
      ),
      '[]'::jsonb
    )
  )
from public.cms_app_sections s
where f.section_id = s.id
  and s.section_key = 'package_segna_x'
  and f.frame_type = 'subscription_plan_landing'
  and s.deleted_at is null
  and (
    strpos(coalesce(f.draft_payload::text, ''), 'Économisez ~15%') > 0
    or strpos(coalesce(f.draft_payload::text, ''), 'Économisez ~25%') > 0
    or strpos(coalesce(f.published_payload::text, ''), 'Économisez ~15%') > 0
    or strpos(coalesce(f.published_payload::text, ''), 'Économisez ~25%') > 0
  );
