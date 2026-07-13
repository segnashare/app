-- Profil membre : cartes looks avec auteur, cover et limite alignée sur l'app.

create or replace function public.get_member_inspirations_v1(
  p_author_user_id uuid,
  p_limit integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_cards jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_limit := greatest(1, least(coalesce(p_limit, 12), 50));

  if exists (
    select 1 from public.community_blocked_user_ids(v_uid) b
    where b.blocked_user_id = p_author_user_id
  ) then
    return jsonb_build_object('cards', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source', x.source,
        'id', x.id,
        'title', x.title,
        'caption', x.caption,
        'media_type', x.media_type,
        'media_bucket', x.media_bucket,
        'media_paths', x.media_paths,
        'video_poster_path', x.video_poster_path,
        'cover_aspect', x.cover_aspect,
        'cover_transform', x.cover_transform,
        'author_user_id', x.author_user_id,
        'author_display_name', x.author_display_name,
        'author_avatar_path', x.author_avatar_path,
        'author_instagram_username', x.author_instagram_username,
        'like_count', x.like_count,
        'is_liked', x.is_liked,
        'linked_item_count', x.linked_item_count,
        'preview_item_ids', x.preview_item_ids,
        'published_at', x.published_at
      )
      order by x.published_at desc nulls last
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select
      'member'::public.inspiration_source as source,
      ci.id,
      coalesce(nullif(trim(ci.title), ''), 'Look Segna') as title,
      coalesce(public.tags_caption_for_inspiration(ci.id), coalesce(ci.caption, '')) as caption,
      ci.media_type,
      ci.media_bucket,
      ci.media_paths,
      ci.video_poster_path,
      ci.cover_aspect,
      ci.cover_transform,
      ci.author_user_id,
      coalesce(nullif(trim(up.display_name), ''), 'Membre Segna') as author_display_name,
      public.user_profile_avatar_storage_path(up.photos) as author_avatar_path,
      nullif(trim(up.profile_data->>'instagram_username'), '') as author_instagram_username,
      ci.like_count,
      exists (
        select 1
        from public.inspiration_likes il
        where il.member_user_id = v_uid
          and il.source = 'member'::public.inspiration_source
          and il.inspiration_id = ci.id
          and il.deleted_at is null
      ) as is_liked,
      coalesce(ci.linked_item_count, 0) as linked_item_count,
      (
        select coalesce(jsonb_agg(cii.item_id order by cii.sort_order), '[]'::jsonb)
        from (
          select cii2.item_id, cii2.sort_order
          from public.community_inspiration_items cii2
          where cii2.inspiration_id = ci.id
          order by cii2.sort_order
          limit 3
        ) cii
      ) as preview_item_ids,
      ci.published_at
    from public.community_inspirations ci
    left join public.user_profiles up
      on up.user_id = ci.author_user_id
      and up.deleted_at is null
    where ci.author_user_id = p_author_user_id
      and ci.status = 'published'
      and ci.deleted_at is null
    order by ci.published_at desc nulls last
    limit v_limit
  ) x;

  return jsonb_build_object('cards', coalesce(v_cards, '[]'::jsonb));
end;
$$;

grant execute on function public.get_member_inspirations_v1(uuid, integer) to authenticated;
