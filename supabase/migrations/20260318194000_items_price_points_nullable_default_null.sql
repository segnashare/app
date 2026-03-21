alter table public.items
  alter column price_points drop default,
  alter column price_points drop not null;
