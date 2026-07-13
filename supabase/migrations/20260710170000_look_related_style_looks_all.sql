-- Page look : toutes les inspis publiées ; celles avec pièce commune en premier.

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
        'id', ranked.id,
        'title', ranked.title,
        'media_type', ranked.media_type,
        'media_bucket', ranked.presentation_storage_bucket,
        'media_paths', ranked.media_paths,
        'video_poster_path', ranked.video_poster_path
      )
      order by ranked.shares_piece desc, ranked.sort_order asc, ranked.published_at desc nulls last, ranked.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select
      sl.id,
      sl.title,
      sl.media_type,
      sl.presentation_storage_bucket,
      sl.media_paths,
      sl.video_poster_path,
      sl.sort_order,
      sl.published_at,
      sl.created_at,
      exists (
        select 1
        from public.style_look_items sli
        join public.style_look_items anchor on anchor.item_id = sli.item_id
        where sli.look_id = sl.id
          and anchor.look_id = p_look_id
      ) as shares_piece
    from public.style_looks sl
    where sl.published = true
      and sl.id <> p_look_id
  ) ranked;
$$;

grant execute on function public.get_look_related_style_looks_v1(uuid) to authenticated;

comment on function public.get_look_related_style_looks_v1(uuid) is
  'Inspis Style publiées pour la section « Plus d''inspirations » (pièce commune en premier, puis les autres).';
