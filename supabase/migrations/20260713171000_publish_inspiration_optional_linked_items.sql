-- Publication look : pièces liées optionnelles (0 à 12).

create or replace function public.publish_community_inspiration(
  p_inspiration_id uuid default null,
  p_title text default '',
  p_caption text default '',
  p_media_type public.inspiration_media_type default 'photo',
  p_media_bucket text default 'bucket_community',
  p_media_paths jsonb default '[]'::jsonb,
  p_video_poster_path text default null,
  p_item_ids uuid[] default array[]::uuid[],
  p_role_labels text[] default array[]::text[],
  p_cover_aspect text default 'portrait',
  p_cover_transform jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_path_count integer;
  v_item_count integer;
  v_cover_aspect text;
  i integer;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  v_cover_aspect := case lower(trim(coalesce(p_cover_aspect, '')))
    when 'landscape' then 'landscape'
    when 'square' then 'square'
    else 'portrait'
  end;

  v_path_count := coalesce(jsonb_array_length(p_media_paths), 0);
  if p_media_type = 'photo'::public.inspiration_media_type and v_path_count < 1 then
    raise exception 'Photo required';
  elsif p_media_type = 'video'::public.inspiration_media_type and v_path_count < 1 then
    raise exception 'Video required';
  elsif p_media_type = 'dump'::public.inspiration_media_type and v_path_count < 2 then
    raise exception 'Dump requires at least 2 photos';
  end if;

  v_item_count := coalesce(cardinality(p_item_ids), 0);
  if v_item_count > 12 then
    raise exception 'Maximum 12 linked items';
  end if;

  if p_inspiration_id is not null then
    update public.community_inspirations
    set
      title = left(coalesce(trim(p_title), ''), 120),
      caption = left(coalesce(trim(p_caption), ''), 2000),
      media_type = p_media_type,
      media_bucket = coalesce(nullif(trim(p_media_bucket), ''), 'bucket_community'),
      media_paths = p_media_paths,
      video_poster_path = nullif(trim(p_video_poster_path), ''),
      cover_aspect = v_cover_aspect,
      cover_transform = p_cover_transform,
      status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
    where id = p_inspiration_id and author_user_id = v_uid and deleted_at is null
    returning id into v_id;

    if v_id is null then raise exception 'Inspiration not found'; end if;

    delete from public.community_inspiration_items where inspiration_id = v_id;
  else
    insert into public.community_inspirations (
      author_user_id, title, caption, media_type, media_bucket,
      media_paths, video_poster_path, cover_aspect, cover_transform,
      status, published_at, linked_item_count
    ) values (
      v_uid,
      left(coalesce(trim(p_title), ''), 120),
      left(coalesce(trim(p_caption), ''), 2000),
      p_media_type,
      coalesce(nullif(trim(p_media_bucket), ''), 'bucket_community'),
      p_media_paths,
      nullif(trim(p_video_poster_path), ''),
      v_cover_aspect,
      p_cover_transform,
      'published',
      now(),
      v_item_count
    )
    returning id into v_id;
  end if;

  for i in 1..v_item_count loop
    insert into public.community_inspiration_items (inspiration_id, item_id, sort_order, role_label)
    values (
      v_id,
      p_item_ids[i],
      i - 1,
      case
        when p_role_labels is not null and i <= cardinality(p_role_labels)
        then nullif(left(trim(p_role_labels[i]), 40), '')
        else null
      end
    );
  end loop;

  perform public.community_sync_linked_item_count(v_id);
  perform public.xp_award_action('xp_post_look', 'community', v_id::text);
  if v_item_count >= 3 then
    perform public.xp_award_action(
      'xp_post_look_3_plus_items',
      'community',
      v_id::text,
      'post3:' || v_id::text
    );
  end if;

  return jsonb_build_object('id', v_id, 'published', true);
end;
$$;

grant execute on function public.publish_community_inspiration(
  uuid, text, text, public.inspiration_media_type, text, jsonb, text, uuid[], text[], text, jsonb
) to authenticated;
