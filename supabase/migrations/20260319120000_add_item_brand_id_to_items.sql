alter table public.items
  add column if not exists item_brand_id uuid references public.item_brands(id) on delete set null;
