-- Hard delete d'un item : autorisé même s'il est référencé dans cart_items
-- (lignes panier soft-deleted ou in_cart), sauf si l'item est reserved / sold.
--
-- 1) FK cart_items → items : ON DELETE CASCADE (aligné sur la plupart des autres enfants).
-- 2) BEFORE DELETE sur items : refuse si status ∈ {reserved, sold}.

alter table public.cart_items
  drop constraint if exists cart_items_item_id_fkey;

alter table public.cart_items
  add constraint cart_items_item_id_fkey
  foreign key (item_id) references public.items (id)
  on delete cascade;

create or replace function public.trg_items_block_delete_if_reserved_or_sold()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('reserved'::public.item_status, 'sold'::public.item_status) then
    raise exception
      'Impossible de supprimer l''item % : status = % (reserved / sold interdits).',
      old.id,
      old.status
      using errcode = '23514';
  end if;
  return old;
end;
$$;

comment on function public.trg_items_block_delete_if_reserved_or_sold() is
  'Bloque le hard DELETE d''un item reserved ou sold ; les paniers (cart_items) cascaderont sinon.';

drop trigger if exists trg_items_block_delete_if_reserved_or_sold on public.items;
create trigger trg_items_block_delete_if_reserved_or_sold
  before delete on public.items
  for each row
  execute function public.trg_items_block_delete_if_reserved_or_sold();
