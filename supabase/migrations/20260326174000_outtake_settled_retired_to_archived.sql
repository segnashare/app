-- Règle métier retour:
-- les items restent visibles côté prêts client pendant le workflow retour.
-- Archivage uniquement quand outtake.stage = settled ET items.status = retired.

create or replace function public.item_outtake_after_settled_archive_retired_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage::text = 'settled'
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
  then
    update public.items
    set
      status = 'archived'::public.item_status,
      updated_at = now()
    where id = new.item_id
      and status = 'retired'::public.item_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_item_outtake_after_settled_archive_retired_item on public.item_outtake;
create trigger trg_item_outtake_after_settled_archive_retired_item
after insert or update of stage on public.item_outtake
for each row
execute function public.item_outtake_after_settled_archive_retired_item();
