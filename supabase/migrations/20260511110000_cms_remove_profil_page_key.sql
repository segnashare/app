-- Supprime la page CMS « profil » : les sections concernées passent sous « autre » (édition BO unifiée).
-- L’app continue d’utiliser section_key = profile_plus_tab pour /profile.

update public.cms_app_section_on_page
set
  page_key = 'autre',
  page_sort_order = page_sort_order + 500
where page_key = 'profil';

update public.cms_app_sections
set page_key = 'autre'
where page_key = 'profil';

alter table public.cms_app_section_on_page
drop constraint if exists cms_app_section_on_page_page_key_check;

alter table public.cms_app_section_on_page
add constraint cms_app_section_on_page_page_key_check check (
  page_key in ('boutique', 'panier', 'echange', 'autre')
);
