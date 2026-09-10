-- Retour mixte (pièces OK + litige) / clôture grâce : les lignes verified
-- ne passaient jamais à archived, donc items.status restait reserved.
-- 1) Hold inventaire = reserved|verification_pending sur panier vivant,
--    ou in_cart|reservation_pending — pas une ligne déjà contrôlée.
-- 2) Relâcher dès qu'une ligne passe à verified (pas seulement archived).
-- 3) À l'archivage panier, archiver les lignes verified (déclenche le relâchement).

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
      and c.status in (
        'checkout_pending'::public.cart_status,
        'confirmed'::public.cart_status,
        'disputed'::public.cart_status
      )
      and ci.status in (
        'reserved'::public.cart_item_status,
        'verification_pending'::public.cart_item_status
      )
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
      and ci.status in (
        'in_cart'::public.cart_item_status,
        'reservation_pending'::public.cart_item_status
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
  'Recalcule items.status après changement de ligne panier. Une ligne verified/rejected/archived ne retient plus la pièce. Ne touche pas cleaning / sold / perte / draft.';

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

  if new.status not in (
    'archived'::public.cart_item_status,
    'verified'::public.cart_item_status
  ) then
    return new;
  end if;

  if old.status is not distinct from new.status then
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
  and new.status in (
    'archived'::public.cart_item_status,
    'verified'::public.cart_item_status
  )
)
execute function public.trg_cart_items_release_item_on_archived();

create or replace function public.trg_carts_archive_verified_lines_on_archived()
returns trigger
language plpgsql
security definer
set search_path to public
as $fn$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is distinct from 'archived'::public.cart_status then
    return new;
  end if;

  if old.status is not distinct from 'archived'::public.cart_status then
    return new;
  end if;

  if new.deleted_at is not null then
    return new;
  end if;

  update public.cart_items ci
  set
    status = 'archived'::public.cart_item_status,
    updated_at = timezone('utc', now())
  where ci.cart_id = new.id
    and ci.deleted_at is null
    and ci.status = 'verified'::public.cart_item_status;

  return new;
end;
$fn$;

comment on function public.trg_carts_archive_verified_lines_on_archived() is
  'Panier archivé (grâce, litige mixte, etc.) : archive les lignes verified pour relâcher les pièces OK.';

drop trigger if exists trg_carts_archive_verified_lines_on_archived on public.carts;
create trigger trg_carts_archive_verified_lines_on_archived
after update of status on public.carts
for each row
when (
  old.status is distinct from new.status
  and new.status = 'archived'::public.cart_status
)
execute function public.trg_carts_archive_verified_lines_on_archived();

-- Rattrapage : lignes verified sur panier déjà clos → archived (déclenche le relâchement).
update public.cart_items ci
set
  status = 'archived'::public.cart_item_status,
  updated_at = timezone('utc', now())
where ci.deleted_at is null
  and ci.status = 'verified'::public.cart_item_status
  and exists (
    select 1
    from public.carts c
    where c.id = ci.cart_id
      and c.deleted_at is null
      and c.status in ('archived'::public.cart_status, 'disputed'::public.cart_status)
  );

-- Filet : reserved sans hold vivant (ligne reserved/pending sur panier vivant).
do $backfill$
declare
  r record;
begin
  for r in
    select i.id
    from public.items i
    where i.deleted_at is null
      and i.status = 'reserved'::public.item_status
      and not exists (
        select 1
        from public.cart_items ci
        join public.carts c on c.id = ci.cart_id
        where ci.item_id = i.id
          and ci.deleted_at is null
          and c.deleted_at is null
          and c.status in (
            'checkout_pending'::public.cart_status,
            'confirmed'::public.cart_status,
            'disputed'::public.cart_status
          )
          and ci.status in (
            'reserved'::public.cart_item_status,
            'verification_pending'::public.cart_item_status
          )
      )
  loop
    perform public.recompute_item_status_after_cart_line_change(r.id);
  end loop;
end;
$backfill$;
