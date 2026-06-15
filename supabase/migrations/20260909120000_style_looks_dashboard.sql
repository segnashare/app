-- Tenues éditoriales centralisées (onglet Style du tableau de bord backoffice).

create table if not exists public.style_looks (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  intro text not null default '',
  presentation_storage_bucket text not null default 'bucket_cms_app',
  presentation_storage_path text null,
  sort_order integer not null default 0,
  published boolean not null default false,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.style_look_items (
  id uuid primary key default gen_random_uuid(),
  look_id uuid not null references public.style_looks (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  sort_order integer not null default 0,
  role_label text null,
  created_at timestamptz not null default now(),
  constraint style_look_items_look_item_key unique (look_id, item_id)
);

create index if not exists idx_style_looks_sort
  on public.style_looks (sort_order asc, created_at desc);

create index if not exists idx_style_look_items_look_sort
  on public.style_look_items (look_id, sort_order asc);

alter table public.style_looks enable row level security;
alter table public.style_look_items enable row level security;

create policy style_looks_select_published
  on public.style_looks
  for select
  to authenticated
  using (published = true);

create policy style_look_items_select_published
  on public.style_look_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.style_looks l
      where l.id = look_id
        and l.published = true
    )
  );

comment on table public.style_looks is
  'Tenues éditoriales (photo de présentation + pièces liées), gérées depuis le tableau de bord Style.';

comment on table public.style_look_items is
  'Pièces catalogue associées à une tenue Style (ordre + rôle optionnel).';
