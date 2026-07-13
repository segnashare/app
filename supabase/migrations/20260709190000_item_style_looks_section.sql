-- Fiche item : inspis Style (style_looks) liées à une pièce publiée.

create or replace function public.get_item_style_looks_v1(p_item_id uuid)
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
  join public.style_look_items sli on sli.look_id = sl.id
  where sli.item_id = p_item_id
    and sl.published = true;
$$;

grant execute on function public.get_item_style_looks_v1(uuid) to authenticated;

comment on function public.get_item_style_looks_v1(uuid) is
  'Inspis Style publiées contenant une pièce (section « Inspire-toi » fiche item).';
