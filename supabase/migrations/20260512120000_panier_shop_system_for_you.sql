-- Rail AUTO « Susceptibles de vous plaire » : liaison optionnelle page Panier (réordonnancement BO).
-- L’app rend `shop_system_for_you` sur /cart si la clé est présente dans `get_cms_panier_section_order`.

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'panier', 25
from public.cms_app_sections s
where s.section_key = 'shop_system_for_you'
  and s.deleted_at is null
on conflict (section_id, page_key) do nothing;
