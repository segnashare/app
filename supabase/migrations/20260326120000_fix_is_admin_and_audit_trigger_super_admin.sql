-- is_admin() et audit_activity_event_from_db_trigger() référençaient encore
-- 'super_admin'::app_role (valeur supprimée de l'enum) → erreur au login
-- quand le trigger audit touche auth.users (mise à jour last_sign_in, etc.).

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.has_role('admin'::app_role);
$function$;

do $$
declare
  s text;
begin
  select replace(
    pg_get_functiondef(oid),
    $old$'super_admin'::public.app_role$old$,
    $new$'admin'::public.app_role$new$
  )
  into s
  from pg_proc
  where proname = 'audit_activity_event_from_db_trigger'
    and pronamespace = 'public'::regnamespace;

  if s is not null then
    execute s;
  end if;
end;
$$;
