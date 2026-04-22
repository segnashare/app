-- Exemples de fond par diapositive (onboarding 3 carrousel). N’écrase pas si la clé existe déjà.

update public.cms_app_section_frames f
set
  draft_payload = draft_payload || v.patch,
  published_payload = published_payload || v.patch
from (
  select
    f2.id,
    jsonb_build_object(
      'slide_background_hex',
      case (row_number() over (order by f2.sort_order) - 1)
        when 0 then '#E8E4DC'
        when 1 then '#C8D9D2'
        else '#4B5F32'
      end
    ) as patch
  from public.cms_app_section_frames f2
  join public.cms_app_sections s on s.id = f2.section_id
  where s.section_key = 'onboarding_3_intro'
    and f2.frame_type = 'onboarding_stack_image'
) v
where f.id = v.id
  and not (coalesce(f.published_payload, '{}'::jsonb) ? 'slide_background_hex');
