-- Page CMS « Auth » + collage d’accueil : déplacé en 20260511120100 (tables / colonnes / contraintes CMS pas encore en place).
-- Ici : RPC stable pour l’app ; remplacée par la version complète après le bootstrap CMS.

create or replace function public.get_cms_auth_landing_frames()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select '[]'::jsonb;
$$;

grant execute on function public.get_cms_auth_landing_frames() to anon;
grant execute on function public.get_cms_auth_landing_frames() to authenticated;

comment on function public.get_cms_auth_landing_frames() is
  'Frames publiées du collage d’accueil /auth (lecture publique). Placeholder jusqu’au bootstrap CMS.';
