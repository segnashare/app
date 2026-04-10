-- Section CMS intégrée au bloc « Panier actif » sur /exchange lorsque le panier est vide.
-- Visible dans le BO sous la page Échange ; non incluse dans l’ordre de page (RPC) pour éviter un double rendu.

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
  'exchange_cart_empty',
  'Échange — Panier vide (suggestions)',
  6,
  'echange',
  15,
  jsonb_build_object(
    'title', 'Pour commencer',
    'hide_section_title', false,
    'default_frame_type', 'shop_link_card',
    'allowed_frame_types',
    jsonb_build_array(
      'offer_card',
      'promo_ad',
      'editorial_card',
      'shop_link_card',
      'shop_item_ref',
      'shop_category_ref',
      'shop_brand_ref'
    )
  ),
  jsonb_build_object(
    'title', 'Pour commencer',
    'hide_section_title', false,
    'default_frame_type', 'shop_link_card',
    'allowed_frame_types',
    jsonb_build_array(
      'offer_card',
      'promo_ad',
      'editorial_card',
      'shop_link_card',
      'shop_item_ref',
      'shop_category_ref',
      'shop_brand_ref'
    )
  )
)
on conflict (section_key) do update
set
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title),
  page_key = excluded.page_key;

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'echange', 15
from public.cms_app_sections s
where s.section_key = 'exchange_cart_empty'
on conflict (section_id, page_key) do update
set
  page_sort_order = excluded.page_sort_order,
  deleted_at = null;

create or replace function public.get_cms_echange_section_order()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
begin
  v_plan := public.get_effective_plan_code_for_cms();
  return coalesce(
    (
      select jsonb_agg(s.section_key order by p.page_sort_order asc, s.section_key asc)
      from public.cms_app_section_on_page p
      join public.cms_app_sections s on s.id = p.section_id
      where p.page_key = 'echange'
        and p.deleted_at is null
        and s.deleted_at is null
        and s.section_key <> 'exchange_cart_empty'
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_echange_section_order() to authenticated;

comment on function public.get_cms_echange_section_order() is
  'Ordre Échange : placements actifs, filtré par plan. Exclut exchange_cart_empty (rendu dans le bloc panier vide).';
