-- Retire le bloc natif « Tendances » de la page Accueil.

update public.cms_app_section_on_page p
set deleted_at = now()
from public.cms_app_sections s
where p.section_id = s.id
  and s.section_key = 'home_system_style_looks'
  and p.page_key = 'home'
  and p.deleted_at is null;
