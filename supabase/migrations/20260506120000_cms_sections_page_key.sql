-- Regroupement des sections CMS par « page » + ordre local (drag & drop dans le backoffice).

alter table public.cms_app_sections
  add column if not exists page_key text not null default 'autre';

alter table public.cms_app_sections
  add column if not exists page_sort_order integer not null default 0;

create index if not exists idx_cms_app_sections_page_sort
  on public.cms_app_sections (page_key, page_sort_order, id);

-- Affectation des pages (clés stables côté BO)
update public.cms_app_sections
set page_key = 'boutique'
where section_key in (
  'shop_home_capsules',
  'shop_section_discover',
  'shop_section_categories',
  'shop_section_preferred_brands',
  'shop_section_deals',
  'shop_section_french'
);

update public.cms_app_sections set page_key = 'panier' where section_key = 'cart_offers';
update public.cms_app_sections set page_key = 'echange' where section_key = 'commerce_promo_ad';
update public.cms_app_sections set page_key = 'profil' where section_key = 'profile_plus_tab';

update public.cms_app_sections set page_key = 'autre' where page_key = 'autre' and section_key not in (
  'shop_home_capsules',
  'shop_section_discover',
  'shop_section_categories',
  'shop_section_preferred_brands',
  'shop_section_deals',
  'shop_section_french',
  'cart_offers',
  'commerce_promo_ad',
  'profile_plus_tab'
);

-- Ordre dans chaque page (à partir du sort_order historique)
with ranked as (
  select
    id,
    (row_number() over (partition by page_key order by sort_order asc, section_key asc) - 1) * 10 as pso
  from public.cms_app_sections
)
update public.cms_app_sections s
set page_sort_order = ranked.pso
from ranked
where s.id = ranked.id;

comment on column public.cms_app_sections.page_key is
  'Page app regroupant la section (boutique, panier, echange, profil, autre).';
comment on column public.cms_app_sections.page_sort_order is
  'Ordre d’affichage des sections au sein de la page (BO).';
