-- Page d'accueil membre : inspis Style publiées (section Tendances).

create or replace function public.get_home_style_looks_v1(p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sl.id,
        'title', sl.title,
        'media_type', sl.media_type,
        'media_bucket', sl.presentation_storage_bucket,
        'media_paths', sl.media_paths,
        'video_poster_path', sl.video_poster_path
      )
      order by sl.sort_order asc, sl.published_at desc nulls last, sl.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select sl.*
    from public.style_looks sl
    where sl.published = true
    order by sl.sort_order asc, sl.published_at desc nulls last, sl.created_at desc
    limit greatest(1, least(coalesce(p_limit, 24), 48))
  ) sl;
$$;

grant execute on function public.get_home_style_looks_v1(integer) to authenticated;

comment on function public.get_home_style_looks_v1(integer) is
  'Inspis Style publiées pour la page d''accueil membre (/home).';
