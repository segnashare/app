-- Valeur d’enum seule, dans sa propre transaction de migration.
-- Sinon PostgreSQL : « unsafe use of new value ... of enum type » (55P04) si on référence
-- 'corporate_inventory'::user_status dans le même fichier que ALTER TYPE ... ADD VALUE.

do $guard$
begin
  if exists (
    select 1
    from pg_namespace n
    join pg_type t on t.typnamespace = n.oid
    where n.nspname = 'public'
      and t.typname = 'user_status'
  )
  and not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_status'
      and e.enumlabel = 'corporate_inventory'
  ) then
    execute 'alter type public.user_status add value ''corporate_inventory''';
  end if;
end
$guard$;
