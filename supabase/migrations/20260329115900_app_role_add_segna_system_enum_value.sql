-- PG 55P04 : une valeur d’enum ajoutée dans une transaction ne peut pas être référencée
-- (cast / INSERT) dans la même transaction. L’INSERT user_roles est dans 20260329120000.

do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'app_role'
  ) then
    begin
      alter type public.app_role add value if not exists 'segna_system';
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;
