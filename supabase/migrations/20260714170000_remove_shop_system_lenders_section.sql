-- Retire le bloc natif « Nos supers prêteuses » de la page Boutique.

update public.cms_app_section_on_page p
set deleted_at = now()
from public.cms_app_sections s
where p.section_id = s.id
  and s.section_key = 'shop_system_lenders'
  and p.page_key = 'boutique'
  and p.deleted_at is null;

update public.cms_app_sections
set deleted_at = now()
where section_key = 'shop_system_lenders'
  and deleted_at is null;
