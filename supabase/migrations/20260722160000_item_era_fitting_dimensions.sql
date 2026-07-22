-- Époque, fitting / dimensions pièce, description reste text (HTML/markdown allégé côté app).

alter table public.items
  add column if not exists item_era text null,
  add column if not exists item_fitting text null,
  add column if not exists item_dimensions jsonb null default '{}'::jsonb;

comment on column public.items.item_era is
  'Époque : décennie (1980s|1990s|2000s|2010s) ou année précise (ex. 1998).';
comment on column public.items.item_fitting is
  'Texte libre : comment la pièce taille / coupe / longueur.';
comment on column public.items.item_dimensions is
  'Mesures optionnelles { waist, hips, bust, length, inseam, sleeve, shoulder } → string.';

alter table public.items
  drop constraint if exists items_item_era_check;

alter table public.items
  add constraint items_item_era_check
  check (
    item_era is null
    or item_era in ('1980s', '1990s', '2000s', '2010s')
    or item_era ~ '^[12][0-9]{3}$'
  );
