-- 1) Dé-réservation fiable quand une ligne panier est retirée (soft-delete ou DELETE dur).
--    Avant : la fonction trigger tournait avec les droits de l’appelant ; sans politique UPDATE sur
--    public.items pour le membre, l’UPDATE items ne faisait rien → pièces bloquées en reserved.
-- 2) Suppression des verrous item_inventory_locks pour (cart_id, item_id) de la ligne retirée.
-- 3) Trigger supplémentaire AFTER DELETE (chemins admin / maintenance).
-- 4) Rattrapage : items reserved sans aucune ligne panier « vivante ».

create or replace function public.trg_cart_items_recompute_item_status_on_soft_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item_id uuid;
  v_cart_id uuid;
  v_next_status public.item_status;
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not distinct from new.deleted_at or old.deleted_at is not null then
      return new;
    end if;
    if new.deleted_at is null then
      return new;
    end if;
  elsif tg_op = 'DELETE' then
    null;
  else
    return coalesce(new, old);
  end if;

  v_item_id := old.item_id;
  v_cart_id := old.cart_id;

  if v_item_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  delete from public.item_inventory_locks il
  where il.cart_id = v_cart_id
    and il.item_id = v_item_id;

  if exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
      and ci.status = 'reserved'::public.cart_item_status
  ) then
    v_next_status := 'reserved'::public.item_status;
  elsif exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = v_item_id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in (
        'active'::public.cart_status,
        'checkout_pending'::public.cart_status,
        'confirmed'::public.cart_status
      )
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
    and i.deleted_at is null
    and i.status is distinct from v_next_status;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.trg_cart_items_recompute_item_status_on_soft_delete() is
  'Après soft-delete (deleted_at) ou DELETE d’une ligne panier : supprime le lock inventaire, recalcule items.status (reserved / in_cart / available). SECURITY DEFINER pour passer la RLS sur items.';

drop trigger if exists trg_cart_items_recompute_item_status_on_soft_delete on public.cart_items;
create trigger trg_cart_items_recompute_item_status_on_soft_delete
after update of deleted_at on public.cart_items
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function public.trg_cart_items_recompute_item_status_on_soft_delete();

drop trigger if exists trg_cart_items_recompute_item_status_on_delete on public.cart_items;
create trigger trg_cart_items_recompute_item_status_on_delete
after delete on public.cart_items
for each row
execute function public.trg_cart_items_recompute_item_status_on_soft_delete();

-- Verrous orphelins (ligne panier déjà soft-delete / incohérences)
delete from public.item_inventory_locks il
where not exists (
  select 1
  from public.cart_items ci
  where ci.cart_id = il.cart_id
    and ci.item_id = il.item_id
    and ci.deleted_at is null
);

-- Pièces encore reserved sans aucune ligne panier non supprimée
update public.items i
set
  status = 'available'::public.item_status,
  updated_at = now()
where i.deleted_at is null
  and i.status = 'reserved'::public.item_status
  and not exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = i.id
      and ci.deleted_at is null
      and c.deleted_at is null
  );
