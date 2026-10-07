create table if not exists public.ai_fashion_model_photos (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ai_fashion_models(id) on delete cascade,
  slot text not null,
  image_path text not null,
  created_at timestamptz not null default now(),
  constraint ai_fashion_model_photos_slot_check check (slot in ('front', 'pivot', 'back', 'extra')),
  constraint ai_fashion_model_photos_model_slot_unique unique (model_id, slot)
);

create index if not exists ai_fashion_model_photos_model_id_idx
  on public.ai_fashion_model_photos (model_id);

comment on table public.ai_fashion_model_photos is
  'Vues d''un mannequin IA : avant, pivot, arrière, libre (2 à 4 photos).';

alter table public.ai_fashion_model_photos enable row level security;

insert into public.ai_fashion_model_photos (model_id, slot, image_path)
select m.id, 'front', m.image_path
from public.ai_fashion_models m
where m.image_path is not null
  and char_length(trim(m.image_path)) > 0
  and not exists (
    select 1 from public.ai_fashion_model_photos p
    where p.model_id = m.id and p.slot = 'front'
  );

alter table public.ai_fashion_models
  alter column image_path drop not null;
