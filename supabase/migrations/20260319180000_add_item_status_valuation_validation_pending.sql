do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_status'
      and e.enumlabel = 'valuation'
  ) then
    alter type public.item_status add value 'valuation' before 'available';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_status'
      and e.enumlabel = 'validation_pending'
  ) then
    alter type public.item_status add value 'validation_pending' before 'available';
  end if;
end $$;
