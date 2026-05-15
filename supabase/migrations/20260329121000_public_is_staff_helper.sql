-- Plusieurs policies RLS appellent is_staff() ; la chaîne neuve n’avait pas cette fonction.
-- Aligné sur item_condition_history (232300) : moderator ou admin, ligne user_roles active.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path to public
as $$
  select public.has_role('moderator'::public.app_role)
      or public.has_role('admin'::public.app_role);
$$;

comment on function public.is_staff() is
  'True si l’utilisateur courant a un rôle staff (moderator ou admin) actif.';

grant execute on function public.is_staff() to authenticated;
