-- Signalement membre : catégorie, périmètre (commande entière / articles), photos.

alter table public.cart_disputes
  add column if not exists category text,
  add column if not exists scope text,
  add column if not exists photo_paths jsonb not null default '[]'::jsonb;

comment on column public.cart_disputes.category is
  'Type de problème (member_report) : item_lost, item_missing, item_damaged, …';

comment on column public.cart_disputes.scope is
  'Périmètre : whole_cart | selected_items';

comment on column public.cart_disputes.photo_paths is
  'Chemins Storage (bucket_items) des photos jointes au signalement.';
