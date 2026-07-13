-- Page CMS « Accueil » (/home) : ordre modulaire + blocs natifs réordonnables.

alter table public.cms_app_section_on_page
  drop constraint if exists cms_app_section_on_page_page_key_check;

alter table public.cms_app_section_on_page
  add constraint cms_app_section_on_page_page_key_check check (
    page_key in ('boutique', 'panier', 'echange', 'autre', 'auth', 'onboarding', 'home')
  );

-- ---------------------------------------------------------------------------
-- Blocs natifs Accueil (pas de frames CMS ; rendu dans l’app)
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
    'home_system_style_looks',
    'Accueil — Tendances (looks)',
    50,
    'home',
    10,
    '{"title":"Tendances","show_more_arrow":true,"more_href":"/community"}'::jsonb,
    '{"title":"Tendances","show_more_arrow":true,"more_href":"/community"}'::jsonb
  ),
  (
    'home_system_nouveautes',
    'Accueil — Nouveautés catalogue',
    51,
    'home',
    20,
    '{"title":"Nouveautés","show_more_arrow":true,"more_href":"/shop/discover"}'::jsonb,
    '{"title":"Nouveautés","show_more_arrow":true,"more_href":"/shop/discover"}'::jsonb
  ),
  (
    'home_system_feed',
    'Accueil — Get the inspi (feed)',
    52,
    'home',
    90,
    '{"title":"Get the inspi","hide_section_title":false}'::jsonb,
    '{"title":"Get the inspi","hide_section_title":false}'::jsonb
  )
on conflict (section_key) do update
set
  page_key = excluded.page_key,
  display_title = coalesce(nullif(trim(cms_app_sections.display_title), ''), excluded.display_title);

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, 'home', v.ord
from public.cms_app_sections s
inner join (
  values
    ('home_system_style_looks', 10),
    ('home_system_nouveautes', 20),
    ('home_system_feed', 90)
) as v (k, ord) on s.section_key = v.k
on conflict (section_id, page_key) do update
set page_sort_order = excluded.page_sort_order;

-- ---------------------------------------------------------------------------
-- RPC : ordre des section_key pour la page Accueil (authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_home_section_order()
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
      where p.page_key = 'home'
        and p.deleted_at is null
        and s.deleted_at is null
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_home_section_order() to authenticated;

comment on function public.get_cms_home_section_order() is
  'Ordre Accueil : placements actifs (deleted_at null), sections non archivées, filtré par plan.';
