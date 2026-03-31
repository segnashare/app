-- Quand une ligne panier est soft-delete (deleted_at), recalculer le status item
-- en tenant compte des autres paniers actifs/réservés.

create or replace function public.trg_cart_items_recompute_item_status_on_soft_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_item_id uuid;
  v_next_status public.item_status;
begin
  v_item_id := old.item_id;
  if v_item_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status = 'reserved'
      and ci.status = 'reserved'
  ) then
    v_next_status := 'reserved'::public.item_status;
  elsif exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('active', 'reserved')
  ) then
    v_next_status := 'in_cart'::public.item_status;
  else
    v_next_status := 'available'::public.item_status;
  end if;

  update public.items i
  set
    status = v_next_status,
    updated_at = now()
  where i.id = v_item_id
    and i.status is distinct from v_next_status;

  return new;
end;
$$;

drop trigger if exists trg_cart_items_recompute_item_status_on_soft_delete on public.cart_items;
create trigger trg_cart_items_recompute_item_status_on_soft_delete
after update of deleted_at on public.cart_items
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function public.trg_cart_items_recompute_item_status_on_soft_delete();

