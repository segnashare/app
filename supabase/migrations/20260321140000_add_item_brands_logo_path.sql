-- Lier les marques à leurs logos SVG dans le storage
alter table public.item_brands
  add column if not exists logo_path text;

comment on column public.item_brands.logo_path is 'Chemin dans le bucket brand_logos (ex: claudie-pierlot.svg)';
