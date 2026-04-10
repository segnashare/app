-- Sections réutilisables sur plusieurs pages (même frames / config) + flag « modèle » pour le back-office.

-- ---------------------------------------------------------------------------
-- Table de liaison : une section peut apparaître sur plusieurs pages (ordre par page).
-- ---------------------------------------------------------------------------

create table if not exists public.cms_app_section_on_page (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  section_id uuid not null references public.cms_app_sections (id) on delete cascade,
  page_key text not null,
  page_sort_order integer not null default 0,
  constraint cms_app_section_on_page_page_key_check check (
    page_key in ('boutique', 'panier', 'echange', 'profil', 'autre')
  ),
  constraint cms_app_section_on_page_unique unique (section_id, page_key)
);

create index if not exists idx_cms_app_section_on_page_page_sort
  on public.cms_app_section_on_page (page_key, page_sort_order, id);

comment on table public.cms_app_section_on_page is
  'Placement d’une section CMS sur une page (ordre). Même section_id = contenu synchronisé entre pages.';

alter table public.cms_app_section_on_page enable row level security;

drop policy if exists "cms_app_section_on_page_service_only" on public.cms_app_section_on_page;
create policy "cms_app_section_on_page_service_only"
on public.cms_app_section_on_page
for all
using (false)
with check (false);

-- ---------------------------------------------------------------------------
-- Backfill : une ligne par section existante (page_key / ordre historiques).
-- ---------------------------------------------------------------------------

insert into public.cms_app_section_on_page (section_id, page_key, page_sort_order)
select s.id, s.page_key, s.page_sort_order
from public.cms_app_sections s
on conflict (section_id, page_key) do nothing;

-- ---------------------------------------------------------------------------
-- Modèle : repérable dans le BO pour le sélecteur « réutiliser ».
-- ---------------------------------------------------------------------------

alter table public.cms_app_sections
  add column if not exists is_section_model boolean not null default false;

comment on column public.cms_app_sections.is_section_model is
  'Si true : section proposée en tête comme modèle réutilisable sur d’autres pages.';

-- ---------------------------------------------------------------------------
-- RPC boutique : ordre depuis la liaison (cohérent avec multi-pages).
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_boutique_section_order()
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
      where p.page_key = 'boutique'
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_boutique_section_order() to authenticated;

comment on function public.get_cms_boutique_section_order() is
  'Liste ordonnée des section_key boutique (liaison page) visibles pour le plan effectif.';
