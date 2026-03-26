-- Keep item draft-like deletion semantics consistent:
-- 1) When a draft-like item is soft-deleted (deleted_at set), enforce status=draft_deleted
-- 2) When status is set to draft_deleted, enforce deleted_at is set

create or replace function public.sync_items_draft_deleted_and_deleted_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- If status is explicitly draft_deleted, ensure deleted_at is always set.
  if new.status = 'draft_deleted'::public.item_status and new.deleted_at is null then
    new.deleted_at := now();
  end if;

  -- If item is soft-deleted from draft, normalize status.
  if old.deleted_at is null
     and new.deleted_at is not null
     and old.status = 'draft'::public.item_status
     and new.status <> 'draft_deleted'::public.item_status then
    new.status := 'draft_deleted'::public.item_status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_items_sync_draft_deleted_and_deleted_at on public.items;
create trigger trg_items_sync_draft_deleted_and_deleted_at
before update on public.items
for each row
execute function public.sync_items_draft_deleted_and_deleted_at();

-- Backfill existing data inconsistencies.
update public.items
set status = 'draft_deleted',
    updated_at = now()
where deleted_at is not null
  and status = 'draft';

update public.items
set deleted_at = now(),
    updated_at = now()
where status = 'draft_deleted'
  and deleted_at is null;
