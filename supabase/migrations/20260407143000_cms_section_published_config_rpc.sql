-- Expose la config publiée d’une section (ex. masquer le titre) sans charger les frames.

create or replace function public.get_cms_section_published_config(p_section_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.published_section_config, '{}'::jsonb)
  from public.cms_app_sections s
  where s.section_key = nullif(trim(coalesce(p_section_key, '')), '')
  limit 1;
$$;

grant execute on function public.get_cms_section_published_config(text) to authenticated;
grant execute on function public.get_cms_section_published_config(text) to anon;

comment on function public.get_cms_section_published_config(text) is
  'Config JSON publiée de la section (titres, hide_section_title, etc.), sans frames.';
