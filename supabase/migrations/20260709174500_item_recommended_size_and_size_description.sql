alter table public.items
  add column if not exists item_recommended_size_id uuid references public.sizes(id) on delete set null,
  add column if not exists item_size_description text;

comment on column public.items.item_recommended_size_id is
  'Taille Segna recommandée (peut différer de item_size_id, taille étiquette).';

comment on column public.items.item_size_description is
  'Description / précisions sur le fit ou la taille affichée sur la fiche produit.';
