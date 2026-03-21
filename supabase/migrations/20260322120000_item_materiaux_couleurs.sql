-- Tables catalogues pour matériaux et couleurs d'items
create table if not exists public.item_materiaux (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text not null,
  slug text not null unique
);

create table if not exists public.item_couleurs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text not null,
  slug text not null unique
);

create trigger trg_item_materiaux_updated_at
before update on public.item_materiaux
for each row execute function public.set_updated_at();

create trigger trg_item_couleurs_updated_at
before update on public.item_couleurs
for each row execute function public.set_updated_at();

alter table public.item_materiaux enable row level security;
alter table public.item_couleurs enable row level security;

-- Lecture publique pour les catalogues
create policy "item_materiaux_select_all"
on public.item_materiaux for select to authenticated using (true);

create policy "item_couleurs_select_all"
on public.item_couleurs for select to authenticated using (true);

-- Colonnes sur items
alter table public.items
  add column if not exists item_materiaux_id uuid references public.item_materiaux(id) on delete set null,
  add column if not exists item_couleur_id uuid references public.item_couleurs(id) on delete set null;

comment on column public.items.item_materiaux_id is 'FK vers le matériau principal de la pièce';
comment on column public.items.item_couleur_id is 'FK vers la couleur principale de la pièce';
