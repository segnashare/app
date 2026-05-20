-- Après clôture retour BO (lignes cart_items → archived), libérer items.status (reserved → available)
-- et retirer les verrous inventaire. Sans cela, la pièce reste bloquée en reserved après validation.

create or replace function public.recompute_item_status_after_cart_line_change(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_next_status public.item_status;
begin
  if p_item_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = p_item_id
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
    where ci.item_id = p_item_id
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
    updated_at = timezone('utc', now())
  where i.id = p_item_id
    and i.deleted_at is null
    and i.status is distinct from v_next_status
    and i.status in ('reserved'::public.item_status, 'in_cart'::public.item_status);
end;
$fn$;

comment on function public.recompute_item_status_after_cart_line_change(uuid) is
  'Recalcule items.status après archivage ligne panier (emprunt clôturé). Ne touche pas cleaning / draft.';

create or replace function public.trg_cart_items_release_item_on_archived()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is distinct from 'archived'::public.cart_item_status then
    return new;
  end if;

  if old.status is not distinct from 'archived'::public.cart_item_status then
    return new;
  end if;

  if new.deleted_at is not null then
    return new;
  end if;

  delete from public.item_inventory_locks il
  where il.cart_id = new.cart_id
    and il.item_id = new.item_id;

  perform public.recompute_item_status_after_cart_line_change(new.item_id);

  return new;
end;
$fn$;

drop trigger if exists trg_cart_items_release_item_on_archived on public.cart_items;
create trigger trg_cart_items_release_item_on_archived
after update of status on public.cart_items
for each row
when (
  old.status is distinct from new.status
  and new.status = 'archived'::public.cart_item_status
)
execute function public.trg_cart_items_release_item_on_archived();

-- Rattrapage : emprunts archivés, lignes archived, pièces encore reserved.
update public.items i
set
  status = 'available'::public.item_status,
  updated_at = timezone('utc', now())
where i.deleted_at is null
  and i.status = 'reserved'::public.item_status
  and not exists (
    select 1
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where ci.item_id = i.id
      and ci.deleted_at is null
      and c.deleted_at is null
      and c.status in ('checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
      and ci.status in (
        'reserved'::public.cart_item_status,
        'verification_pending'::public.cart_item_status,
        'verified'::public.cart_item_status
      )
  );

delete from public.item_inventory_locks il
where not exists (
  select 1
  from public.cart_items ci
  join public.carts c on c.id = ci.cart_id
  where ci.cart_id = il.cart_id
    and ci.item_id = il.item_id
    and ci.deleted_at is null
    and c.deleted_at is null
    and c.status in ('checkout_pending'::public.cart_status, 'confirmed'::public.cart_status)
    and ci.status in (
      'reserved'::public.cart_item_status,
      'verification_pending'::public.cart_item_status,
      'verified'::public.cart_item_status
    )
);
