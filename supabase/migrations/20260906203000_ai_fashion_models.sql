create table if not exists public.ai_fashion_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_path text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_fashion_models_name_not_blank check (char_length(trim(name)) > 0)
);

create table if not exists public.ai_fashion_model_categories (
  model_id uuid not null references public.ai_fashion_models(id) on delete cascade,
  category_id uuid not null references public.item_categories(id) on delete cascade,
  primary key (model_id, category_id)
);

create table if not exists public.ai_fashion_model_sizes (
  model_id uuid not null references public.ai_fashion_models(id) on delete cascade,
  size_id uuid not null references public.sizes(id) on delete cascade,
  primary key (model_id, size_id)
);

create index if not exists ai_fashion_model_categories_category_id_idx
  on public.ai_fashion_model_categories (category_id);

create index if not exists ai_fashion_model_sizes_size_id_idx
  on public.ai_fashion_model_sizes (size_id);

comment on table public.ai_fashion_models is
  'Mannequins de référence FASHN (try-on) pour le back-office, filtrés par catégorie et taille.';

alter table public.ai_fashion_models enable row level security;
alter table public.ai_fashion_model_categories enable row level security;
alter table public.ai_fashion_model_sizes enable row level security;
