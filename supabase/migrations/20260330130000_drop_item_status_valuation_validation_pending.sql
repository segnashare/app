-- Retrait de valuation et validation_pending de public.item_status (pipeline porte sur item_intake + draft/listed).
-- Recreer l'enum sans ces labels : PostgreSQL ne permet pas DROP VALUE sur les enums historiques.

-- 0) Donnees (au cas ou des lignes legacy subsistent)
update public.items
set status = 'draft'::public.item_status,
    updated_at = now()
where status::text in ('valuation', 'validation_pending');

update public.item_status_history
set from_status = 'draft'::public.item_status
where from_status::text in ('valuation', 'validation_pending');

update public.item_status_history
set to_status = 'draft'::public.item_status
where to_status::text in ('valuation', 'validation_pending');

-- 1) Triggers dependants des fonctions qui castent vers item_status
drop trigger if exists trg_items_sync_draft_deleted_and_deleted_at on public.items;
drop trigger if exists trg_items_after_insert_item_intake on public.items;
drop trigger if exists trg_item_intake_after_update_sync_listed on public.item_intake;

drop function if exists public.sync_items_draft_deleted_and_deleted_at();
drop function if exists public.items_after_insert_ensure_item_intake();
drop function if exists public.item_intake_after_update_sync_items_listed();

-- RLS : la politique items_select reference status::item_status
drop policy if exists items_select on public.items;

-- 2) Nouvel enum sans valuation / validation_pending
create type public.item_status_new as enum (
  'draft',
  'draft_deleted',
  'listed',
  'available',
  'in_cart',
  'reserved',
  'retired',
  'archived'
);

-- 3) Colonnes : migrer vers item_status_new
alter table public.items
  alter column status drop default;

alter table public.items
  alter column status type public.item_status_new using (
    case status::text
      when 'valuation' then 'draft'::public.item_status_new
      when 'validation_pending' then 'draft'::public.item_status_new
      else status::text::public.item_status_new
    end
  );

alter table public.items
  alter column status set default 'available'::public.item_status_new;

alter table public.item_status_history
  alter column from_status type public.item_status_new using (
    case
      when from_status is null then null
      when from_status::text in ('valuation', 'validation_pending') then 'draft'::public.item_status_new
      else from_status::text::public.item_status_new
    end
  );

alter table public.item_status_history
  alter column to_status type public.item_status_new using (
    case to_status::text
      when 'valuation' then 'draft'::public.item_status_new
      when 'validation_pending' then 'draft'::public.item_status_new
      else to_status::text::public.item_status_new
    end
  );

-- 4) Ancien type plus reference
drop type public.item_status;

-- 5) Renommer item_status_new -> item_status
alter type public.item_status_new rename to item_status;

comment on type public.item_status is
  'Statut operational item (catalogue / panier). Pipeline annonce : item_intake. Plus de valuation/validation_pending sur items.';

-- RLS restauree (meme logique qu'avant migration)
create policy items_select on public.items
for select
using (
  (
    deleted_at is null
    and status = any (
      array[
        'available'::public.item_status,
        'in_cart'::public.item_status,
        'reserved'::public.item_status
      ]
    )
  )
  or owner_user_id = auth.uid()
  or is_staff()
);

-- 6) Fonctions restaurees (sans branches legacy valuation / validation_pending)
create or replace function public.sync_items_draft_deleted_and_deleted_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'draft_deleted'::public.item_status and new.deleted_at is null then
    new.deleted_at := now();
  end if;

  if old.deleted_at is null
     and new.deleted_at is not null
     and old.status = 'draft'::public.item_status
     and new.status <> 'draft_deleted'::public.item_status
  then
    new.status := 'draft_deleted'::public.item_status;
  end if;

  return new;
end;
$$;

create trigger trg_items_sync_draft_deleted_and_deleted_at
before update on public.items
for each row
execute function public.sync_items_draft_deleted_and_deleted_at();

create or replace function public.items_after_insert_ensure_item_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.item_intake (item_id, listing_stage, metadata)
  values (
    new.id,
    case new.status::text
      when 'draft' then 'draft'::public.item_intake_listing_stage
      when 'draft_deleted' then 'draft'::public.item_intake_listing_stage
      when 'listed' then 'validated'::public.item_intake_listing_stage
      else 'validated'::public.item_intake_listing_stage
    end,
    case
      when new.status::text = 'draft_deleted' then jsonb_build_object('legacy_items_status', 'draft_deleted')
      else '{}'::jsonb
    end
  )
  on conflict (item_id) do nothing;
  return new;
end;
$$;

create trigger trg_items_after_insert_item_intake
after insert on public.items
for each row
execute function public.items_after_insert_ensure_item_intake();

create or replace function public.item_intake_after_update_sync_items_listed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_stage::text = 'verified' and new.listing_stage::text = 'validated' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.fulfillment_stage is distinct from new.fulfillment_stage) then
      update public.items
      set
        status = 'listed'::public.item_status,
        updated_at = now()
      where id = new.item_id
        and deleted_at is null
        and status not in ('in_cart'::public.item_status, 'reserved'::public.item_status);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_item_intake_after_update_sync_listed
after insert or update of fulfillment_stage on public.item_intake
for each row
execute function public.item_intake_after_update_sync_items_listed();
