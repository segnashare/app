-- Fusion BO : les sections intro onboarding passent sur la page CMS « auth » (une seule colonne Pages).

with mx as (
  select coalesce(max(page_sort_order), -10) as m
  from public.cms_app_section_on_page
  where page_key = 'auth'
    and deleted_at is null
),
ord as (
  select sop.id,
    row_number() over (order by sop.page_sort_order, s.section_key) as rn
  from public.cms_app_section_on_page sop
  join public.cms_app_sections s on s.id = sop.section_id
  where sop.page_key = 'onboarding'
    and sop.deleted_at is null
    and s.section_key in ('onboarding_1_intro', 'onboarding_2_intro', 'onboarding_3_intro')
)
update public.cms_app_section_on_page sop
set
  page_key = 'auth',
  page_sort_order = (select m from mx) + ord.rn * 10
from ord
where sop.id = ord.id;

-- Aligner les champs legacy sur cms_app_sections (affichage / fallback sans table liaison)
update public.cms_app_sections s
set
  page_key = p.page_key,
  page_sort_order = p.page_sort_order,
  updated_at = now()
from public.cms_app_section_on_page p
where p.section_id = s.id
  and p.page_key = 'auth'
  and p.deleted_at is null
  and s.section_key in ('onboarding_1_intro', 'onboarding_2_intro', 'onboarding_3_intro');
