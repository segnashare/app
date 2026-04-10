-- Blocs panier « auto » (lignes, offres CMS, échange) + RPC d’ordre comme la boutique.
-- (Colonnes soft-delete : idempotent si 20260510160000 est déjà passée.)

alter table public.cms_app_section_on_page
  add column if not exists deleted_at timestamptz null;

alter table public.cms_app_sections
  add column if not exists deleted_at timestamptz null;

-- ---------------------------------------------------------------------------
-- Sentinelles : pas de frames CMS ; rendu natif dans l’app
-- ---------------------------------------------------------------------------

insert into public.cms_app_sections (
  section_key,
  display_title,
  sort_order,
  page_key,
  page_sort_order,
  draft_section_config,
  published_section_config
)
values
  (
    'cart_system_items',
    'Panier — lignes et ajout d’articles',
    5,
    'panier',
    10,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'cart_system_exchange',
    'Panier — Échange et sous-total',
    6,
    'panier',
    30,
    '{}'::jsonb,
    '{}'::jsonb
  )
on conflict (section_key) do update
set
  page_key = excluded.page_key,
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title);

-- Cohérence colonne legacy (même si l’ordre effectif vient de la liaison)
update public.cms_app_sections
set page_sort_order = case section_key
  when 'cart_system_items' then 10
  when 'cart_offers' then 20
  when 'cart_system_exchange' then 30
  else page_sort_order
end
where page_key = 'panier'
  and section_key in ('cart_system_items', 'cart_offers', 'cart_system_exchange');

-- ---------------------------------------------------------------------------
-- Liaison page panier : ordre par défaut 10 / 20 / 30
-- ---------------------------------------------------------------------------

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'panier', v.ord
from public.cms_app_sections s
inner join (
  values
    ('cart_system_items', 10),
    ('cart_offers', 20),
    ('cart_system_exchange', 30)
) as v (k, ord) on s.section_key = v.k
on conflict (section_id, page_key) do update
set page_sort_order = excluded.page_sort_order;

-- ---------------------------------------------------------------------------
-- RPC : ordre des section_key pour la page panier (authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_panier_section_order()
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
      where p.page_key = 'panier'
        and p.deleted_at is null
        and s.deleted_at is null
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_panier_section_order() to authenticated;

comment on function public.get_cms_panier_section_order() is
  'Ordre panier : placements actifs (deleted_at null), sections non archivées, filtré par plan.';
