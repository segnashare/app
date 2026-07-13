create table if not exists public.mannequins (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  size_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mannequins_first_name_not_blank check (char_length(trim(first_name)) > 0)
);

create unique index if not exists mannequins_first_name_lower_unique
  on public.mannequins (lower(trim(first_name)));

comment on table public.mannequins is
  'Mannequins Segna pour les shootings produit (prénom + mensurations).';

comment on column public.mannequins.first_name is 'Prénom affiché lors de la sélection mannequin.';
comment on column public.mannequins.size_description is
  'Description textuelle de la taille du mannequin (ex. 1m72 · 36 · S).';

alter table public.items
  add column if not exists photographed_on_mannequin boolean not null default false,
  add column if not exists item_mannequin_id uuid references public.mannequins(id) on delete set null;

comment on column public.items.photographed_on_mannequin is
  'True si les photos produit ont été prises sur mannequin Segna.';

comment on column public.items.item_mannequin_id is
  'Mannequin lié lorsque photographed_on_mannequin est true.';

create index if not exists items_item_mannequin_id_idx
  on public.items (item_mannequin_id)
  where item_mannequin_id is not null;

alter table public.mannequins enable row level security;

drop policy if exists "mannequins_select_authenticated" on public.mannequins;
create policy "mannequins_select_authenticated"
  on public.mannequins
  for select
  to authenticated
  using (true);

insert into public.mannequins (first_name, size_description)
select v.first_name, v.size_description
from (
  values
    ('Léa', '1m72 · 36 · S'),
    ('Emma', '1m68 · 38 · M'),
    ('Inès', '1m75 · 34 · XS')
) as v(first_name, size_description)
where not exists (
  select 1
  from public.mannequins m
  where lower(trim(m.first_name)) = lower(trim(v.first_name))
);
