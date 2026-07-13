-- Looks éditoriaux : créditer un membre (tag @) au lieu de @segna par défaut.

alter table public.style_looks
  add column if not exists featured_member_user_id uuid null references public.users (id) on delete set null;

create index if not exists idx_style_looks_featured_member
  on public.style_looks (featured_member_user_id)
  where featured_member_user_id is not null;

comment on column public.style_looks.featured_member_user_id is
  'Membre affiché comme auteur du look éditorial (feed / fiche). Null = @segna.';

-- Feed : auteur style look = membre affilié si renseigné.

create or replace function public.get_community_feed_v1(
  p_mode text default 'explorer',
  p_limit integer default 20,
  p_cursor_score numeric default null,
  p_cursor_source public.inspiration_source default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_mode text;
  v_cards jsonb;
  v_next_score numeric;
  v_next_source public.inspiration_source;
  v_next_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 40));
  v_mode := case when lower(trim(coalesce(p_mode, ''))) = 'pour_toi' then 'pour_toi' else 'explorer' end;

  with
  blocked as (
    select blocked_user_id from public.community_blocked_user_ids(v_uid)
  ),
  user_fav_items as (
    select distinct f.item_id
    from public.item_favorites f
    where f.user_id = v_uid and f.deleted_at is null
  ),
  followed_authors as (
    select mf.following_user_id
    from public.member_follows mf
    where mf.follower_user_id = v_uid and mf.deleted_at is null
  ),
  recent_impressions as (
    select source, inspiration_id, count(*) as seen_count
    from public.member_inspiration_impressions mi
    where mi.member_user_id = v_uid
      and mi.created_at >= now() - interval '7 days'
    group by source, inspiration_id
  ),
  segna_rows as (
    select
      'segna_style'::public.inspiration_source as source,
      sl.id,
      coalesce(nullif(trim(sl.title), ''), 'Inspiration Segna') as title,
      coalesce(public.tags_caption_for_look(sl.id), '') as caption,
      sl.media_type,
      sl.presentation_storage_bucket as media_bucket,
      case
        when sl.media_paths is not null and jsonb_array_length(sl.media_paths) > 0 then sl.media_paths
        when sl.presentation_storage_path is not null then jsonb_build_array(sl.presentation_storage_path)
        else '[]'::jsonb
      end as media_paths,
      sl.video_poster_path,
      sl.cover_aspect,
      sl.cover_transform,
      sl.featured_member_user_id as author_user_id,
      case
        when sl.featured_member_user_id is null then 'Segna'::text
        else coalesce(nullif(trim(up_feat.display_name), ''), 'Membre Segna')
      end as author_display_name,
      case
        when sl.featured_member_user_id is null then null::text
        else public.user_profile_avatar_storage_path(up_feat.photos)
      end as author_avatar_path,
      case
        when sl.featured_member_user_id is null then null::text
        else nullif(trim(up_feat.profile_data->>'instagram_username'), '')
      end as author_instagram_username,
      sl.like_count,
      sl.published_at,
      sl.created_at,
      (
        select coalesce(jsonb_agg(sli.item_id order by sli.sort_order), '[]'::jsonb)
        from public.style_look_items sli
        where sli.look_id = sl.id
      ) as linked_item_ids
    from public.style_looks sl
    left join public.user_profiles up_feat
      on up_feat.user_id = sl.featured_member_user_id and up_feat.deleted_at is null
    where sl.published = true
  ),
  member_rows as (
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
      ci.published_at,
      ci.created_at,
      (
        select coalesce(jsonb_agg(cii.item_id order by cii.sort_order), '[]'::jsonb)
        from public.community_inspiration_items cii
        where cii.inspiration_id = ci.id
      ) as linked_item_ids
    from public.community_inspirations ci
    left join public.user_profiles up on up.user_id = ci.author_user_id and up.deleted_at is null
    where ci.status = 'published'
      and ci.deleted_at is null
      and ci.author_user_id <> v_uid
      and not exists (select 1 from blocked b where b.blocked_user_id = ci.author_user_id)
  ),
  merged as (
    select * from segna_rows
    union all
    select * from member_rows
  ),
  scored as (
    select
      m.*,
      coalesce(
        (
          select count(*)::integer
          from jsonb_array_elements_text(m.linked_item_ids) lid(item_id)
          join user_fav_items ufi on ufi.item_id = lid.item_id::uuid
        ),
        0
      ) as favorite_overlap,
      case when m.author_user_id is not null and exists (
        select 1 from followed_authors fa where fa.following_user_id = m.author_user_id
      ) then 1 else 0 end as is_followed_author,
      case when m.source = 'segna_style'::public.inspiration_source then 1 else 0 end as is_segna,
      coalesce(ri.seen_count, 0) as seen_count,
      exists (
        select 1 from public.inspiration_likes il
        where il.member_user_id = v_uid
          and il.source = m.source
          and il.inspiration_id = m.id
          and il.deleted_at is null
      ) as is_liked,
      (
        case v_mode
          when 'pour_toi' then
            (case when m.author_user_id is not null and exists (
              select 1 from followed_authors fa where fa.following_user_id = m.author_user_id
            ) then 40 else 0 end)
            + (case when m.source = 'segna_style'::public.inspiration_source then 25 else 0 end)
            + least(30, coalesce(
              (
                select count(*) * 8
                from jsonb_array_elements_text(m.linked_item_ids) lid(item_id)
                join user_fav_items ufi on ufi.item_id = lid.item_id::uuid
              ),
              0
            ))
          else 0
        end
        + least(20, ln(1 + m.like_count) * 5)
        + greatest(0, 15 - extract(epoch from (now() - coalesce(m.published_at, m.created_at))) / 86400)
        - least(15, coalesce(ri.seen_count, 0) * 4)
      )::numeric as score
    from merged m
    left join recent_impressions ri on ri.source = m.source and ri.inspiration_id = m.id
  ),
  filtered as (
    select *
    from scored s
    where p_cursor_score is null
      or s.score < p_cursor_score
      or (s.score = p_cursor_score and (
        p_cursor_source is null
        or s.source > p_cursor_source
        or (s.source = p_cursor_source and s.id > p_cursor_id)
      ))
    order by s.score desc, s.source asc, s.id asc
    limit v_limit + 1
  ),
  page as (
    select * from filtered order by score desc, source asc, id asc limit v_limit
  ),
  next_row as (
    select f.score, f.source, f.id
    from filtered f
    order by f.score desc, f.source asc, f.id asc
    offset v_limit
    limit 1
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'source', p.source,
            'id', p.id,
            'title', p.title,
            'caption', p.caption,
            'media_type', p.media_type,
            'media_bucket', p.media_bucket,
            'media_paths', p.media_paths,
            'video_poster_path', p.video_poster_path,
            'cover_aspect', p.cover_aspect,
            'cover_transform', p.cover_transform,
            'author_user_id', p.author_user_id,
            'author_display_name', p.author_display_name,
            'author_avatar_path', p.author_avatar_path,
            'author_instagram_username', p.author_instagram_username,
            'like_count', p.like_count,
            'is_liked', p.is_liked,
            'linked_item_count', jsonb_array_length(coalesce(p.linked_item_ids, '[]'::jsonb)),
            'preview_item_ids', (
              select coalesce(jsonb_agg(val), '[]'::jsonb)
              from (
                select lid.item_id as val
                from jsonb_array_elements_text(coalesce(p.linked_item_ids, '[]'::jsonb)) lid(item_id)
                limit 3
              ) sub
            ),
            'published_at', p.published_at,
            'score', p.score
          )
          order by p.score desc, p.source asc, p.id asc
        )
        from page p
      ),
      '[]'::jsonb
    ),
    nr.score,
    nr.source,
    nr.id
  into v_cards, v_next_score, v_next_source, v_next_id
  from (select 1) _one
  left join next_row nr on true;

  return jsonb_build_object(
    'cards', coalesce(v_cards, '[]'::jsonb),
    'next_cursor', case
      when v_next_id is null then null
      else jsonb_build_object('score', v_next_score, 'source', v_next_source, 'id', v_next_id)
    end
  );
end;
$$;

create or replace function public.get_inspiration_detail_v1(
  p_source public.inspiration_source,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_detail jsonb;
  v_item_ids uuid[];
  v_items jsonb;
  v_tags jsonb;
  v_author_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_source = 'segna_style'::public.inspiration_source then
    select
      jsonb_build_object(
        'source', 'segna_style',
        'id', sl.id,
        'title', coalesce(nullif(trim(sl.title), ''), 'Inspiration Segna'),
        'caption', coalesce(public.tags_caption_for_look(sl.id), ''),
        'media_type', sl.media_type,
        'media_bucket', sl.presentation_storage_bucket,
        'media_paths', case
          when sl.media_paths is not null and jsonb_array_length(sl.media_paths) > 0 then sl.media_paths
          when sl.presentation_storage_path is not null then jsonb_build_array(sl.presentation_storage_path)
          else '[]'::jsonb
        end,
        'video_poster_path', sl.video_poster_path,
        'cover_aspect', sl.cover_aspect,
        'cover_transform', sl.cover_transform,
        'author_user_id', sl.featured_member_user_id,
        'author_display_name', case
          when sl.featured_member_user_id is null then 'Segna'::text
          else coalesce(nullif(trim(up_feat.display_name), ''), 'Membre Segna')
        end,
        'author_avatar_path', case
          when sl.featured_member_user_id is null then null::text
          else public.user_profile_avatar_storage_path(up_feat.photos)
        end,
        'author_instagram_username', case
          when sl.featured_member_user_id is null then null::text
          else nullif(trim(up_feat.profile_data->>'instagram_username'), '')
        end,
        'like_count', sl.like_count,
        'published_at', sl.published_at,
        'is_liked', exists (
          select 1 from public.inspiration_likes il
          where il.member_user_id = v_uid and il.source = 'segna_style'::public.inspiration_source
            and il.inspiration_id = sl.id and il.deleted_at is null
        ),
        'is_following_author', case
          when sl.featured_member_user_id is null then false
          else exists (
            select 1 from public.member_follows mf
            where mf.follower_user_id = v_uid
              and mf.following_user_id = sl.featured_member_user_id
              and mf.deleted_at is null
          )
        end
      ),
      coalesce(array_agg(sli.item_id order by sli.sort_order), array[]::uuid[]),
      sl.featured_member_user_id
    into v_detail, v_item_ids, v_author_id
    from public.style_looks sl
    left join public.user_profiles up_feat
      on up_feat.user_id = sl.featured_member_user_id and up_feat.deleted_at is null
    left join public.style_look_items sli on sli.look_id = sl.id
    where sl.id = p_id and sl.published = true
    group by sl.id, up_feat.display_name, up_feat.photos, up_feat.profile_data;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'label', t.label,
          'category', t.category
        )
        order by slt.sort_order, t.label
      ),
      '[]'::jsonb
    )
    into v_tags
    from public.style_look_tags slt
    join public.tags t on t.id = slt.tag_id
    where slt.look_id = p_id;
  else
    select
      jsonb_build_object(
        'source', 'member',
        'id', ci.id,
        'title', coalesce(nullif(trim(ci.title), ''), 'Look Segna'),
        'caption', coalesce(public.tags_caption_for_inspiration(ci.id), coalesce(ci.caption, '')),
        'media_type', ci.media_type,
        'media_bucket', ci.media_bucket,
        'media_paths', ci.media_paths,
        'video_poster_path', ci.video_poster_path,
        'cover_aspect', ci.cover_aspect,
        'cover_transform', ci.cover_transform,
        'author_user_id', ci.author_user_id,
        'author_display_name', coalesce(nullif(trim(up.display_name), ''), 'Membre Segna'),
        'author_avatar_path', public.user_profile_avatar_storage_path(up.photos),
        'author_instagram_username', nullif(trim(up.profile_data->>'instagram_username'), ''),
        'like_count', ci.like_count,
        'published_at', ci.published_at,
        'is_liked', exists (
          select 1 from public.inspiration_likes il
          where il.member_user_id = v_uid and il.source = 'member'::public.inspiration_source
            and il.inspiration_id = ci.id and il.deleted_at is null
        ),
        'is_following_author', exists (
          select 1 from public.member_follows mf
          where mf.follower_user_id = v_uid and mf.following_user_id = ci.author_user_id and mf.deleted_at is null
        )
      ),
      coalesce(array_agg(cii.item_id order by cii.sort_order), array[]::uuid[]),
      ci.author_user_id
    into v_detail, v_item_ids, v_author_id
    from public.community_inspirations ci
    left join public.user_profiles up on up.user_id = ci.author_user_id and up.deleted_at is null
    left join public.community_inspiration_items cii on cii.inspiration_id = ci.id
    where ci.id = p_id and ci.status = 'published' and ci.deleted_at is null
    group by ci.id, up.display_name, up.photos, up.profile_data;

    if v_author_id is not null and exists (
      select 1 from public.community_blocked_user_ids(v_uid) b where b.blocked_user_id = v_author_id
    ) then
      return null;
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'label', t.label,
          'category', t.category
        )
        order by cit.sort_order, t.label
      ),
      '[]'::jsonb
    )
    into v_tags
    from public.community_inspiration_tags cit
    join public.tags t on t.id = cit.tag_id
    where cit.inspiration_id = p_id;
  end if;

  if v_detail is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_id', cii.item_id,
        'role_label', cii.role_label,
        'sort_order', cii.sort_order
      ) order by cii.sort_order
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select sli.item_id, sli.role_label, sli.sort_order
    from public.style_look_items sli
    where p_source = 'segna_style'::public.inspiration_source and sli.look_id = p_id
    union all
    select cii2.item_id, cii2.role_label, cii2.sort_order
    from public.community_inspiration_items cii2
    where p_source = 'member'::public.inspiration_source and cii2.inspiration_id = p_id
  ) cii;

  return v_detail || jsonb_build_object(
    'companions', v_items,
    'item_ids', to_jsonb(coalesce(v_item_ids, array[]::uuid[])),
    'tags', coalesce(v_tags, '[]'::jsonb)
  );
end;
$$;

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
        'video_poster_path', sl.video_poster_path,
        'cover_aspect', sl.cover_aspect,
        'cover_transform', sl.cover_transform,
        'author_display_name', case
          when sl.featured_member_user_id is null then 'Segna'::text
          else coalesce(nullif(trim(up_feat.display_name), ''), 'Membre Segna')
        end,
        'author_instagram_username', case
          when sl.featured_member_user_id is null then null::text
          else nullif(trim(up_feat.profile_data->>'instagram_username'), '')
        end
      )
      order by sl.sort_order asc, sl.published_at desc nulls last, sl.created_at desc
    ),
    '[]'::jsonb
  )
  from public.style_looks sl
  join public.style_look_items sli on sli.look_id = sl.id
  left join public.user_profiles up_feat
    on up_feat.user_id = sl.featured_member_user_id and up_feat.deleted_at is null
  where sli.item_id = p_item_id
    and sl.published = true;
$$;
