-- Remove deprecated user status history domain objects.
-- We no longer persist user status transitions in a dedicated table.

do $$
declare
  fn record;
begin
  -- Drop any RPC/function that still references the removed table.
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%user_status_history%'
  loop
    execute format(
      'drop function if exists %I.%I(%s) cascade',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  end loop;
end $$;

drop table if exists public.user_status_history cascade;
