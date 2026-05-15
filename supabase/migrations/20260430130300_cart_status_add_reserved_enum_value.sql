-- Valeur enum cart_status « reserved » : migration dédiée (PG 55P04 si ADD VALUE + usage dans la même transaction).

do $body$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_status'
  ) and not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    join pg_namespace n on t.typnamespace = n.oid
    where n.nspname = 'public' and t.typname = 'cart_status' and e.enumlabel = 'reserved'
  ) then
    execute 'alter type public.cart_status add value ''reserved''';
  end if;
end
$body$;
