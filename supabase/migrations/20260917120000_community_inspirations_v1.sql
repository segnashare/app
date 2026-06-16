-- Community inspirations feed (UGC + style_looks), likes, follows, reports.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'inspiration_source'
  ) then
    create type public.inspiration_source as enum ('segna_style', 'member');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'inspiration_media_type'
  ) then
    create type public.inspiration_media_type as enum ('photo', 'video', 'dump');
  end if;
end $$;

-- Extend editorial looks for multi-media.
alter table public.style_looks
  add column if not exists media_type public.inspiration_media_type not null default 'photo',
  add column if not exists media_paths jsonb not null default '[]'::jsonb,
  add column if not exists video_poster_path text null,
  add column if not exists like_count integer not null default 0 check (like_count >= 0);

update public.style_looks
set media_paths = jsonb_build_array(presentation_storage_path)
where presentation_storage_path is not null
  and (media_paths is null or media_paths = '[]'::jsonb);

create table if not exists public.community_inspirations (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.users (id) on delete cascade,
  title text not null default '',
  caption text not null default '',
  media_type public.inspiration_media_type not null default 'photo',
  media_bucket text not null default 'bucket_community',
  media_paths jsonb not null default '[]'::jsonb,
  video_poster_path text null,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  like_count integer not null default 0 check (like_count >= 0),
  linked_item_count integer not null default 0 check (linked_item_count >= 0),
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists idx_community_inspirations_published
  on public.community_inspirations (published_at desc nulls last, created_at desc)
  where status = 'published' and deleted_at is null;

create index if not exists idx_community_inspirations_author
  on public.community_inspirations (author_user_id, published_at desc nulls last)
  where deleted_at is null;

create table if not exists public.community_inspiration_items (
  id uuid primary key default gen_random_uuid(),
  inspiration_id uuid not null references public.community_inspirations (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  sort_order integer not null default 0,
  role_label text null,
  created_at timestamptz not null default now(),
  constraint community_inspiration_items_insp_item_key unique (inspiration_id, item_id)
);

create index if not exists idx_community_inspiration_items_insp
  on public.community_inspiration_items (inspiration_id, sort_order asc);

create table if not exists public.inspiration_likes (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.users (id) on delete cascade,
  source public.inspiration_source not null,
  inspiration_id uuid not null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inspiration_likes_active_unique
  on public.inspiration_likes (member_user_id, source, inspiration_id)
  where deleted_at is null;

create index if not exists idx_inspiration_likes_target
  on public.inspiration_likes (source, inspiration_id)
  where deleted_at is null;

create table if not exists public.member_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references public.users (id) on delete cascade,
  following_user_id uuid not null references public.users (id) on delete cascade,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (follower_user_id <> following_user_id)
);

create unique index if not exists member_follows_active_unique
  on public.member_follows (follower_user_id, following_user_id)
  where deleted_at is null;

create index if not exists idx_member_follows_following
  on public.member_follows (following_user_id)
  where deleted_at is null;

create table if not exists public.member_inspiration_impressions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.users (id) on delete cascade,
  source public.inspiration_source not null,
  inspiration_id uuid not null,
  feed_surface text not null default 'community_v1',
  created_at timestamptz not null default now()
);

create index if not exists idx_member_inspiration_impressions_member
  on public.member_inspiration_impressions (member_user_id, created_at desc);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.users (id) on delete cascade,
  source public.inspiration_source not null,
  inspiration_id uuid not null,
  reason text not null,
  details text null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_community_inspirations_updated_at on public.community_inspirations;
create trigger trg_community_inspirations_updated_at
before update on public.community_inspirations
for each row execute function public.set_updated_at();

drop trigger if exists trg_inspiration_likes_updated_at on public.inspiration_likes;
create trigger trg_inspiration_likes_updated_at
before update on public.inspiration_likes
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_follows_updated_at on public.member_follows;
create trigger trg_member_follows_updated_at
before update on public.member_follows
for each row execute function public.set_updated_at();

alter table public.community_inspirations enable row level security;
alter table public.community_inspiration_items enable row level security;
alter table public.inspiration_likes enable row level security;
alter table public.member_follows enable row level security;
alter table public.member_inspiration_impressions enable row level security;
alter table public.community_reports enable row level security;

grant select, insert, update, delete on public.community_inspirations to authenticated;
grant select, insert, update, delete on public.community_inspiration_items to authenticated;
grant select, insert, update, delete on public.inspiration_likes to authenticated;
grant select, insert, update, delete on public.member_follows to authenticated;
grant select, insert on public.member_inspiration_impressions to authenticated;
grant select, insert on public.community_reports to authenticated;

create policy community_inspirations_select_published
  on public.community_inspirations for select to authenticated
  using (
    (status = 'published' and deleted_at is null)
    or author_user_id = auth.uid()
  );

create policy community_inspirations_insert_own
  on public.community_inspirations for insert to authenticated
  with check (author_user_id = auth.uid());

create policy community_inspirations_update_own
  on public.community_inspirations for update to authenticated
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

create policy community_inspiration_items_select
  on public.community_inspiration_items for select to authenticated
  using (
    exists (
      select 1 from public.community_inspirations ci
      where ci.id = inspiration_id
        and ci.deleted_at is null
        and (ci.status = 'published' or ci.author_user_id = auth.uid())
    )
  );

create policy community_inspiration_items_mutate_own
  on public.community_inspiration_items for all to authenticated
  using (
    exists (
      select 1 from public.community_inspirations ci
      where ci.id = inspiration_id and ci.author_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.community_inspirations ci
      where ci.id = inspiration_id and ci.author_user_id = auth.uid()
    )
  );

create policy inspiration_likes_select_own
  on public.inspiration_likes for select to authenticated
  using (member_user_id = auth.uid());

create policy inspiration_likes_mutate_own
  on public.inspiration_likes for all to authenticated
  using (member_user_id = auth.uid())
  with check (member_user_id = auth.uid());

create policy member_follows_select_own
  on public.member_follows for select to authenticated
  using (follower_user_id = auth.uid() or following_user_id = auth.uid());

create policy member_follows_mutate_own
  on public.member_follows for all to authenticated
  using (follower_user_id = auth.uid())
  with check (follower_user_id = auth.uid());

create policy member_inspiration_impressions_insert_own
  on public.member_inspiration_impressions for insert to authenticated
  with check (member_user_id = auth.uid());

create policy community_reports_insert_own
  on public.community_reports for insert to authenticated
  with check (reporter_user_id = auth.uid());

-- Storage bucket for member UGC.
insert into storage.buckets (id, name, public)
values ('bucket_community', 'bucket_community', false)
on conflict (id) do nothing;

drop policy if exists bucket_community_select_authenticated on storage.objects;
create policy bucket_community_select_authenticated
on storage.objects for select to authenticated
using (bucket_id = 'bucket_community');

drop policy if exists bucket_community_insert_own on storage.objects;
create policy bucket_community_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'bucket_community'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists bucket_community_update_own on storage.objects;
create policy bucket_community_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'bucket_community'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'bucket_community'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists bucket_community_delete_own on storage.objects;
create policy bucket_community_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'bucket_community'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- Helpers
create or replace function public.community_blocked_user_ids(p_viewer uuid)
returns table (blocked_user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select ub.blocked_user_id
  from public.user_blocks ub
  where ub.deleted_at is null
    and ub.blocked_user_id is not null
    and ub.blocked_by_user_id = p_viewer
  union
  select ub.blocked_by_user_id
  from public.user_blocks ub
  where ub.deleted_at is null
    and ub.blocked_user_id = p_viewer
    and ub.blocked_by_user_id is not null;
$$;

create or replace function public.community_sync_inspiration_like_count(
  p_source public.inspiration_source,
  p_inspiration_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.inspiration_likes il
  where il.source = p_source
    and il.inspiration_id = p_inspiration_id
    and il.deleted_at is null;

  if p_source = 'member'::public.inspiration_source then
    update public.community_inspirations
    set like_count = v_count, updated_at = now()
    where id = p_inspiration_id;
  else
    update public.style_looks
    set like_count = v_count, updated_at = now()
    where id = p_inspiration_id;
  end if;
end;
$$;

create or replace function public.community_sync_linked_item_count(p_inspiration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.community_inspiration_items cii
  where cii.inspiration_id = p_inspiration_id;

  update public.community_inspirations
  set linked_item_count = v_count, updated_at = now()
  where id = p_inspiration_id;
end;
$$;

create or replace function public.xp_award_action_for_user(
  p_user_id uuid,
  p_action_code text,
  p_source_type text default 'community',
  p_source_id text default '',
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.xp_actions%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_period_start timestamptz;
  v_current_period_count integer := 0;
  v_delta integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('granted', false, 'reason', 'no_user');
  end if;

  select * into v_action
  from public.xp_actions
  where action_code = p_action_code and is_active = true;

  if not found then
    return jsonb_build_object('granted', false, 'reason', 'unknown_action');
  end if;

  perform public.xp_ensure_user_rows(p_user_id);

  if v_action.one_time then
    if exists (
      select 1 from public.xp_ledger l
      where l.user_id = p_user_id and l.action_code = p_action_code
    ) then
      return jsonb_build_object('granted', false, 'reason', 'one_time_already_awarded');
    end if;
  end if;

  if v_action.cap_period <> 'none' and coalesce(v_action.cap_count, 0) > 0 then
    if v_action.cap_period = 'day' then
      v_period_start := date_trunc('day', v_now);
    elsif v_action.cap_period = 'week' then
      v_period_start := date_trunc('week', v_now);
    elsif v_action.cap_period = 'month' then
      v_period_start := date_trunc('month', v_now);
    else
      v_period_start := '1970-01-01'::timestamptz;
    end if;

    select count(*) into v_current_period_count
    from public.xp_ledger l
    where l.user_id = p_user_id
      and l.action_code = p_action_code
      and l.created_at >= v_period_start;

    if v_current_period_count >= v_action.cap_count then
      return jsonb_build_object('granted', false, 'reason', 'cap_reached');
    end if;
  end if;

  v_delta := v_action.xp_amount;

  begin
    insert into public.xp_ledger (
      user_id, action_code, award_type, xp_delta,
      source_type, source_id, metadata, idempotency_key
    ) values (
      p_user_id, p_action_code, 'action', v_delta,
      coalesce(nullif(trim(p_source_type), ''), 'community'),
      coalesce(trim(p_source_id), ''),
      coalesce(p_metadata, '{}'::jsonb),
      nullif(trim(p_idempotency_key), '')
    );
  exception when unique_violation then
    return jsonb_build_object('granted', false, 'reason', 'duplicate');
  end;

  update public.xp_user_state
  set
    total_xp = greatest(total_xp + v_delta, 0),
    current_level = public.xp_get_level_for_xp(greatest(total_xp + v_delta, 0)),
    last_xp_at = v_now
  where user_id = p_user_id;

  return jsonb_build_object('granted', true, 'xp_delta', v_delta);
end;
$$;

create or replace function public.community_inspiration_author_id(
  p_source public.inspiration_source,
  p_inspiration_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_source = 'member'::public.inspiration_source then (
      select ci.author_user_id from public.community_inspirations ci
      where ci.id = p_inspiration_id and ci.deleted_at is null
    )
    else null::uuid
  end;
$$;

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

  with blocked as (
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
      coalesce(sl.intro, '') as caption,
      sl.media_type,
      sl.presentation_storage_bucket as media_bucket,
      case
        when sl.media_paths is not null and jsonb_array_length(sl.media_paths) > 0 then sl.media_paths
        when sl.presentation_storage_path is not null then jsonb_build_array(sl.presentation_storage_path)
        else '[]'::jsonb
      end as media_paths,
      sl.video_poster_path,
      null::uuid as author_user_id,
      'Segna'::text as author_display_name,
      null::text as author_avatar_path,
      sl.like_count,
      sl.published_at,
      sl.created_at,
      (
        select coalesce(jsonb_agg(sli.item_id order by sli.sort_order), '[]'::jsonb)
        from public.style_look_items sli
        where sli.look_id = sl.id
      ) as linked_item_ids
    from public.style_looks sl
    where sl.published = true
  ),
  member_rows as (
    select
      'member'::public.inspiration_source as source,
      ci.id,
      coalesce(nullif(trim(ci.title), ''), 'Look Segna') as title,
      coalesce(ci.caption, '') as caption,
      ci.media_type,
      ci.media_bucket,
      ci.media_paths,
      ci.video_poster_path,
      ci.author_user_id,
      coalesce(nullif(trim(up.display_name), ''), 'Membre Segna') as author_display_name,
      coalesce(up.photos->>'profile', up.avatar_url) as author_avatar_path,
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
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source', p.source,
          'id', p.id,
          'title', p.title,
          'caption', p.caption,
          'media_type', p.media_type,
          'media_bucket', p.media_bucket,
          'media_paths', p.media_paths,
          'video_poster_path', p.video_poster_path,
          'author_user_id', p.author_user_id,
          'author_display_name', p.author_display_name,
          'author_avatar_path', p.author_avatar_path,
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
      ),
      '[]'::jsonb
    )
  into v_cards
  from page p;

  select f.score, f.source, f.id
  into v_next_score, v_next_source, v_next_id
  from (
    select * from filtered order by score desc, source asc, id asc offset v_limit limit 1
  ) f;

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
        'caption', coalesce(sl.intro, ''),
        'media_type', sl.media_type,
        'media_bucket', sl.presentation_storage_bucket,
        'media_paths', case
          when sl.media_paths is not null and jsonb_array_length(sl.media_paths) > 0 then sl.media_paths
          when sl.presentation_storage_path is not null then jsonb_build_array(sl.presentation_storage_path)
          else '[]'::jsonb
        end,
        'video_poster_path', sl.video_poster_path,
        'author_user_id', null,
        'author_display_name', 'Segna',
        'author_avatar_path', null,
        'like_count', sl.like_count,
        'published_at', sl.published_at,
        'is_liked', exists (
          select 1 from public.inspiration_likes il
          where il.member_user_id = v_uid and il.source = 'segna_style'::public.inspiration_source
            and il.inspiration_id = sl.id and il.deleted_at is null
        ),
        'is_following_author', false
      ),
      coalesce(array_agg(sli.item_id order by sli.sort_order), array[]::uuid[]),
      null::uuid
    into v_detail, v_item_ids, v_author_id
    from public.style_looks sl
    left join public.style_look_items sli on sli.look_id = sl.id
    where sl.id = p_id and sl.published = true
    group by sl.id;
  else
    select
      jsonb_build_object(
        'source', 'member',
        'id', ci.id,
        'title', coalesce(nullif(trim(ci.title), ''), 'Look Segna'),
        'caption', coalesce(ci.caption, ''),
        'media_type', ci.media_type,
        'media_bucket', ci.media_bucket,
        'media_paths', ci.media_paths,
        'video_poster_path', ci.video_poster_path,
        'author_user_id', ci.author_user_id,
        'author_display_name', coalesce(nullif(trim(up.display_name), ''), 'Membre Segna'),
        'author_avatar_path', coalesce(up.photos->>'profile', up.avatar_url),
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
    group by ci.id, up.display_name, up.photos, up.avatar_url;

    if v_author_id is not null and exists (
      select 1 from public.community_blocked_user_ids(v_uid) b where b.blocked_user_id = v_author_id
    ) then
      return null;
    end if;
  end if;

  if v_detail is null then return null; end if;

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
    'item_ids', to_jsonb(coalesce(v_item_ids, array[]::uuid[]))
  );
end;
$$;

create or replace function public.get_related_inspirations_v1(
  p_source public.inspiration_source,
  p_id uuid,
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
  v_author uuid;
  v_item_ids uuid[];
  v_cards jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_limit := greatest(1, least(coalesce(p_limit, 12), 24));

  if p_source = 'member'::public.inspiration_source then
    select ci.author_user_id into v_author
    from public.community_inspirations ci where ci.id = p_id;
  end if;

  select coalesce(array_agg(x.item_id), array[]::uuid[]) into v_item_ids
  from (
    select sli.item_id from public.style_look_items sli
    where p_source = 'segna_style'::public.inspiration_source and sli.look_id = p_id
    union
    select cii.item_id from public.community_inspiration_items cii
    where p_source = 'member'::public.inspiration_source and cii.inspiration_id = p_id
  ) x;

  with blocked as (select blocked_user_id from public.community_blocked_user_ids(v_uid)),
  candidates as (
    select
      'segna_style'::public.inspiration_source as source,
      sl.id,
      coalesce(nullif(trim(sl.title), ''), 'Inspiration Segna') as title,
      sl.media_type,
      sl.presentation_storage_bucket as media_bucket,
      case
        when sl.media_paths is not null and jsonb_array_length(sl.media_paths) > 0 then sl.media_paths
        when sl.presentation_storage_path is not null then jsonb_build_array(sl.presentation_storage_path)
        else '[]'::jsonb
      end as media_paths,
      sl.like_count,
      sl.published_at
    from public.style_looks sl
    where sl.published = true
      and not (p_source = 'segna_style'::public.inspiration_source and sl.id = p_id)
      and (
        exists (
          select 1 from public.style_look_items sli
          where sli.look_id = sl.id and sli.item_id = any(v_item_ids)
        )
      )
    union all
    select
      'member'::public.inspiration_source,
      ci.id,
      coalesce(nullif(trim(ci.title), ''), 'Look Segna'),
      ci.media_type,
      ci.media_bucket,
      ci.media_paths,
      ci.like_count,
      ci.published_at
    from public.community_inspirations ci
    where ci.status = 'published' and ci.deleted_at is null
      and not (p_source = 'member'::public.inspiration_source and ci.id = p_id)
      and not exists (select 1 from blocked b where b.blocked_user_id = ci.author_user_id)
      and (
        ci.author_user_id = v_author
        or exists (
          select 1 from public.community_inspiration_items cii
          where cii.inspiration_id = ci.id and cii.item_id = any(v_item_ids)
        )
      )
  )
  select coalesce(jsonb_agg(row_to_json(c.*)::jsonb order by c.published_at desc nulls last), '[]'::jsonb)
  into v_cards
  from (select * from candidates order by published_at desc nulls last limit v_limit) c;

  return jsonb_build_object('cards', coalesce(v_cards, '[]'::jsonb));
end;
$$;

create or replace function public.toggle_inspiration_like(
  p_source public.inspiration_source,
  p_inspiration_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_existing public.inspiration_likes%rowtype;
  v_liked boolean;
  v_count integer;
  v_author uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_existing
  from public.inspiration_likes il
  where il.member_user_id = v_uid
    and il.source = p_source
    and il.inspiration_id = p_inspiration_id
  for update;

  if found and v_existing.deleted_at is null then
    update public.inspiration_likes
    set deleted_at = now(), updated_at = now()
    where id = v_existing.id;
    v_liked := false;
  elsif found then
    update public.inspiration_likes
    set deleted_at = null, updated_at = now()
    where id = v_existing.id;
    v_liked := true;
  else
    insert into public.inspiration_likes (member_user_id, source, inspiration_id)
    values (v_uid, p_source, p_inspiration_id);
    v_liked := true;
  end if;

  perform public.community_sync_inspiration_like_count(p_source, p_inspiration_id);

  if v_liked then
    v_author := public.community_inspiration_author_id(p_source, p_inspiration_id);
    if v_author is not null and v_author <> v_uid then
      perform public.xp_award_action_for_user(
        v_author,
        'xp_receive_like_on_look',
        'community',
        p_inspiration_id::text,
        'like:' || p_source::text || ':' || p_inspiration_id::text || ':' || v_uid::text
      );
    end if;
  end if;

  if p_source = 'member'::public.inspiration_source then
    select like_count into v_count from public.community_inspirations where id = p_inspiration_id;
  else
    select like_count into v_count from public.style_looks where id = p_inspiration_id;
  end if;

  return jsonb_build_object('liked', v_liked, 'like_count', coalesce(v_count, 0));
end;
$$;

create or replace function public.toggle_member_follow(p_following_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_existing public.member_follows%rowtype;
  v_following boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_following_user_id is null or p_following_user_id = v_uid then
    raise exception 'Invalid follow target';
  end if;

  if exists (
    select 1 from public.community_blocked_user_ids(v_uid) b
    where b.blocked_user_id = p_following_user_id
  ) then
    raise exception 'Cannot follow blocked user';
  end if;

  select * into v_existing
  from public.member_follows mf
  where mf.follower_user_id = v_uid and mf.following_user_id = p_following_user_id
  for update;

  if found and v_existing.deleted_at is null then
    update public.member_follows set deleted_at = now(), updated_at = now() where id = v_existing.id;
    v_following := false;
  elsif found then
    update public.member_follows set deleted_at = null, updated_at = now() where id = v_existing.id;
    v_following := true;
  else
    insert into public.member_follows (follower_user_id, following_user_id)
    values (v_uid, p_following_user_id);
    v_following := true;
  end if;

  if v_following then
    perform public.xp_award_action('xp_add_member_favorite', 'community', p_following_user_id::text);
    perform public.xp_award_action_for_user(
      p_following_user_id,
      'xp_receive_favorite',
      'community',
      v_uid::text,
      'follow:' || v_uid::text || ':' || p_following_user_id::text
    );
  end if;

  return jsonb_build_object('following', v_following);
end;
$$;

create or replace function public.publish_community_inspiration(
  p_inspiration_id uuid default null,
  p_title text default '',
  p_caption text default '',
  p_media_type public.inspiration_media_type default 'photo',
  p_media_bucket text default 'bucket_community',
  p_media_paths jsonb default '[]'::jsonb,
  p_video_poster_path text default null,
  p_item_ids uuid[] default array[]::uuid[],
  p_role_labels text[] default array[]::text[]
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
  i integer;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  v_path_count := coalesce(jsonb_array_length(p_media_paths), 0);
  if p_media_type = 'photo'::public.inspiration_media_type and v_path_count < 1 then
    raise exception 'Photo required';
  elsif p_media_type = 'video'::public.inspiration_media_type and v_path_count < 1 then
    raise exception 'Video required';
  elsif p_media_type = 'dump'::public.inspiration_media_type and v_path_count < 2 then
    raise exception 'Dump requires at least 2 photos';
  end if;

  v_item_count := coalesce(cardinality(p_item_ids), 0);
  if v_item_count < 1 then
    raise exception 'At least one linked item required';
  end if;
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
      media_paths, video_poster_path, status, published_at, linked_item_count
    ) values (
      v_uid,
      left(coalesce(trim(p_title), ''), 120),
      left(coalesce(trim(p_caption), ''), 2000),
      p_media_type,
      coalesce(nullif(trim(p_media_bucket), ''), 'bucket_community'),
      p_media_paths,
      nullif(trim(p_video_poster_path), ''),
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

create or replace function public.report_community_inspiration(
  p_source public.inspiration_source,
  p_inspiration_id uuid,
  p_reason text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Reason required'; end if;

  insert into public.community_reports (reporter_user_id, source, inspiration_id, reason, details)
  values (v_uid, p_source, p_inspiration_id, left(trim(p_reason), 200), nullif(left(trim(coalesce(p_details, '')), 2000), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'reported', true);
end;
$$;

create or replace function public.record_member_inspiration_impression(
  p_source public.inspiration_source,
  p_inspiration_id uuid,
  p_feed_surface text default 'community_v1'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  insert into public.member_inspiration_impressions (member_user_id, source, inspiration_id, feed_surface)
  values (v_uid, p_source, p_inspiration_id, coalesce(nullif(trim(p_feed_surface), ''), 'community_v1'));
end;
$$;

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
  v_limit := greatest(1, least(coalesce(p_limit, 12), 24));

  if exists (
    select 1 from public.community_blocked_user_ids(v_uid) b
    where b.blocked_user_id = p_author_user_id
  ) then
    return jsonb_build_object('cards', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(x.*)::jsonb order by x.published_at desc nulls last), '[]'::jsonb)
  into v_cards
  from (
    select
      'member'::public.inspiration_source as source,
      ci.id,
      coalesce(nullif(trim(ci.title), ''), 'Look Segna') as title,
      ci.media_type,
      ci.media_bucket,
      ci.media_paths,
      ci.video_poster_path,
      ci.like_count,
      ci.published_at
    from public.community_inspirations ci
    where ci.author_user_id = p_author_user_id
      and ci.status = 'published'
      and ci.deleted_at is null
    order by ci.published_at desc nulls last
    limit v_limit
  ) x;

  return jsonb_build_object('cards', coalesce(v_cards, '[]'::jsonb));
end;
$$;

revoke all on function public.community_blocked_user_ids(uuid) from public;
revoke all on function public.community_sync_inspiration_like_count(public.inspiration_source, uuid) from public;
revoke all on function public.community_sync_linked_item_count(uuid) from public;
revoke all on function public.xp_award_action_for_user(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.community_inspiration_author_id(public.inspiration_source, uuid) from public;

grant execute on function public.get_community_feed_v1(text, integer, numeric, public.inspiration_source, uuid) to authenticated;
grant execute on function public.get_inspiration_detail_v1(public.inspiration_source, uuid) to authenticated;
grant execute on function public.get_related_inspirations_v1(public.inspiration_source, uuid, integer) to authenticated;
grant execute on function public.toggle_inspiration_like(public.inspiration_source, uuid) to authenticated;
grant execute on function public.toggle_member_follow(uuid) to authenticated;
grant execute on function public.publish_community_inspiration(uuid, text, text, public.inspiration_media_type, text, jsonb, text, uuid[], text[]) to authenticated;
grant execute on function public.report_community_inspiration(public.inspiration_source, uuid, text, text) to authenticated;
grant execute on function public.record_member_inspiration_impression(public.inspiration_source, uuid, text) to authenticated;
grant execute on function public.get_member_inspirations_v1(uuid, integer) to authenticated;
