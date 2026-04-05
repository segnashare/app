-- CMS modulaire : sections + frames, brouillon / publication, ciblage par plan d'abonnement.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.cms_app_sections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  section_key text not null,
  display_title text,
  sort_order integer not null default 0,
  constraint cms_app_sections_section_key_key unique (section_key)
);

create table if not exists public.cms_app_section_frames (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.cms_app_sections (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sort_order integer not null default 0,
  plan_code text not null,
  frame_type text not null,
  draft_payload jsonb not null default '{}'::jsonb,
  published_payload jsonb,
  published_at timestamptz,
  constraint cms_app_section_frames_plan_check check (
    plan_code in ('guest', 'segna_plus', 'segna_x')
  ),
  constraint cms_app_section_frames_type_check check (
    frame_type in ('offer_card', 'category_capsule', 'promo_ad', 'editorial_card')
  )
);

create index if not exists idx_cms_app_section_frames_section_plan_sort
  on public.cms_app_section_frames (section_id, plan_code, sort_order, id);

drop trigger if exists trg_cms_app_sections_updated_at on public.cms_app_sections;
create trigger trg_cms_app_sections_updated_at
before update on public.cms_app_sections
for each row execute function public.set_updated_at();

drop trigger if exists trg_cms_app_section_frames_updated_at on public.cms_app_section_frames;
create trigger trg_cms_app_section_frames_updated_at
before update on public.cms_app_section_frames
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS : pas de lecture directe côté client (contenu brouillon). Lecture via RPC.
-- ---------------------------------------------------------------------------

alter table public.cms_app_sections enable row level security;
alter table public.cms_app_section_frames enable row level security;

drop policy if exists "cms_app_sections_service_only" on public.cms_app_sections;
create policy "cms_app_sections_service_only"
on public.cms_app_sections
for all
using (false)
with check (false);

drop policy if exists "cms_app_section_frames_service_only" on public.cms_app_section_frames;
create policy "cms_app_section_frames_service_only"
on public.cms_app_section_frames
for all
using (false)
with check (false);

-- ---------------------------------------------------------------------------
-- RPC : frames publiées pour une section, filtrées par plan effectif du membre
-- ---------------------------------------------------------------------------

create or replace function public.get_effective_plan_code_for_cms()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_plan text;
  v_status text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select s.plan_code, s.status
    into v_plan, v_status
  from public.user_subscriptions s
  where s.user_id = v_uid
    and s.provider = 'stripe'
  order by s.updated_at desc
  limit 1;

  v_plan := coalesce(lower(trim(v_plan)), 'guest');
  v_status := coalesce(lower(trim(v_status)), 'inactive');

  if v_status not in ('active', 'trialing') then
    return 'guest';
  end if;

  if v_plan = 'segna_x' then
    return 'segna_x';
  end if;
  if v_plan = 'segna_plus' then
    return 'segna_plus';
  end if;

  return 'guest';
end;
$$;

grant execute on function public.get_effective_plan_code_for_cms() to authenticated;

create or replace function public.get_cms_section_frames(p_section_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_key text;
  v_section_id uuid;
  v_rows jsonb;
begin
  v_plan := public.get_effective_plan_code_for_cms();
  v_key := nullif(trim(coalesce(p_section_key, '')), '');
  if v_key is null then
    raise exception 'section_key requis';
  end if;

  select s.id into v_section_id
  from public.cms_app_sections s
  where s.section_key = v_key
  limit 1;

  if v_section_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', f.plan_code,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.cms_app_section_frames f
  where f.section_id = v_section_id
    and f.plan_code = v_plan
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

grant execute on function public.get_cms_section_frames(text) to authenticated;

comment on table public.cms_app_sections is
  'Blocs CMS app (clé stable section_key). Édition backoffice service role uniquement.';
comment on table public.cms_app_section_frames is
  'Frames par section : brouillon dans draft_payload, publication dans published_payload. Ciblage plan_code.';

-- ---------------------------------------------------------------------------
-- Seed sections (idempotent)
-- ---------------------------------------------------------------------------

insert into public.cms_app_sections (section_key, display_title, sort_order)
values
  ('cart_offers', 'Bloc promo · Panier — Des offres pour vous', 10),
  ('commerce_promo_ad', 'Bloc promo · Échange — mise en avant', 20),
  ('shop_home_capsules', 'Capsules catalogue (accueil boutique)', 30),
  ('profile_plus_tab', 'Profil — Obtenir plus', 40)
on conflict (section_key) do update
set display_title = excluded.display_title,
    sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Storage : images CMS (lecture membres authentifiés pour URL signées)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('bucket_cms_app', 'bucket_cms_app', false)
on conflict (id) do nothing;

drop policy if exists "bucket_cms_app_select_authenticated" on storage.objects;
create policy "bucket_cms_app_select_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'bucket_cms_app');

drop policy if exists "bucket_cms_app_insert_service" on storage.objects;
-- Les uploads passent par le backoffice (service role) ; pas d’insert client direct.
create policy "bucket_cms_app_insert_service"
on storage.objects
for insert
to service_role
with check (bucket_id = 'bucket_cms_app');

drop policy if exists "bucket_cms_app_update_service" on storage.objects;
create policy "bucket_cms_app_update_service"
on storage.objects
for update
to service_role
using (bucket_id = 'bucket_cms_app')
with check (bucket_id = 'bucket_cms_app');

drop policy if exists "bucket_cms_app_delete_service" on storage.objects;
create policy "bucket_cms_app_delete_service"
on storage.objects
for delete
to service_role
using (bucket_id = 'bucket_cms_app');
