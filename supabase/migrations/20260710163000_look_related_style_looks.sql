-- Page look : inspis Style partageant au moins une pièce avec le look courant.

create or replace function public.get_look_related_style_looks_v1(p_look_id uuid)
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
  from public.style_looks sl
  where sl.published = true
    and sl.id <> p_look_id
    and exists (
      select 1
      from public.style_look_items sli
      join public.style_look_items anchor on anchor.item_id = sli.item_id
      where sli.look_id = sl.id
        and anchor.look_id = p_look_id
    );
$$;

grant execute on function public.get_look_related_style_looks_v1(uuid) to authenticated;

comment on function public.get_look_related_style_looks_v1(uuid) is
  'Inspis Style publiées partageant une pièce avec un look (section « plus d''inspis » page look).';
