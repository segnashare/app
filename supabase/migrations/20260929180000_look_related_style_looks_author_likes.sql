-- Section « Plus d'inspirations » : auteur, likes, cover pour cartes feed compact.

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
        'media_paths', ranked.media_paths_resolved,
        'video_poster_path', ranked.video_poster_path,
        'cover_aspect', ranked.cover_aspect,
        'cover_transform', ranked.cover_transform,
        'author_display_name', case
          when ranked.featured_member_user_id is null then 'Segna'::text
          else coalesce(nullif(trim(ranked.display_name), ''), 'Membre Segna')
        end,
        'author_instagram_username', case
          when ranked.featured_member_user_id is null then null::text
          else nullif(trim(ranked.instagram_username), '')
        end,
        'like_count', ranked.like_count,
        'is_liked', ranked.is_liked
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
      case
        when sl.media_paths is not null and jsonb_array_length(sl.media_paths) > 0 then sl.media_paths
        when sl.presentation_storage_path is not null then jsonb_build_array(sl.presentation_storage_path)
        else '[]'::jsonb
      end as media_paths_resolved,
      sl.video_poster_path,
      sl.cover_aspect,
      sl.cover_transform,
      sl.featured_member_user_id,
      up_feat.display_name,
      up_feat.profile_data->>'instagram_username' as instagram_username,
      sl.like_count,
      exists (
        select 1
        from public.inspiration_likes il
        where il.member_user_id = auth.uid()
          and il.source = 'segna_style'::public.inspiration_source
          and il.inspiration_id = sl.id
          and il.deleted_at is null
      ) as is_liked,
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
    left join public.user_profiles up_feat
      on up_feat.user_id = sl.featured_member_user_id and up_feat.deleted_at is null
    where sl.published = true
      and sl.id <> p_look_id
  ) ranked;
$$;
