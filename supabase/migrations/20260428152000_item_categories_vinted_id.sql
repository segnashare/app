alter table public.item_categories
  add column if not exists vinted_id bigint;

comment on column public.item_categories.vinted_id is
  'Identifiant de catégorie Vinted (extrait des URLs /catalog/<id>-<slug>).';
