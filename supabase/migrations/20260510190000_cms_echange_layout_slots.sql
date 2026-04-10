-- Blocs Échange « auto » (panier résumé, prêts, historique) + ordre CMS comme panier / boutique.
-- Le bloc promo `commerce_promo_ad` reste la première section éditable par défaut.

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
    'exchange_system_cart',
    'Échange — Panier actif',
    7,
    'echange',
    20,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'exchange_system_lends',
    'Échange — Mes prêts',
    8,
    'echange',
    30,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'exchange_system_history',
    'Échange — Historique & litiges',
    9,
    'echange',
    40,
    '{}'::jsonb,
    '{}'::jsonb
  )
on conflict (section_key) do update
set
  page_key = excluded.page_key,
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title);

-- ---------------------------------------------------------------------------
-- Liaison page Échange : promo puis blocs natifs (ordre modifiable au BO)
-- ---------------------------------------------------------------------------

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'echange', v.ord
from public.cms_app_sections s
inner join (
  values
    ('commerce_promo_ad', 10),
    ('exchange_system_cart', 20),
    ('exchange_system_lends', 30),
    ('exchange_system_history', 40)
) as v (k, ord) on s.section_key = v.k
on conflict (section_id, page_key) do update
set page_sort_order = excluded.page_sort_order;

-- ---------------------------------------------------------------------------
-- RPC : ordre des section_key pour la page Échange (authenticated)
-- ---------------------------------------------------------------------------

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
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_echange_section_order() to authenticated;

comment on function public.get_cms_echange_section_order() is
  'Ordre Échange : placements actifs (deleted_at null), sections non archivées, filtré par plan.';
