-- Item ↔ catalog tag links + optional shop / inspiration landing pages per tag

alter table public.tags
  add column if not exists page_kind text,
  add column if not exists page_slug text;

alter table public.tags
  drop constraint if exists tags_page_kind_check;

alter table public.tags
  add constraint tags_page_kind_check
  check (page_kind is null or page_kind in ('shop', 'inspiration'));

alter table public.tags
  drop constraint if exists tags_page_slug_requires_kind;

alter table public.tags
  add constraint tags_page_slug_requires_kind
  check (
    (page_kind is null and (page_slug is null or page_slug = ''))
    or (page_kind is not null and page_slug is not null and length(trim(page_slug)) > 0)
  );

create unique index if not exists idx_tags_page_kind_slug_active
  on public.tags (page_kind, page_slug)
  where is_active = true and page_kind is not null and page_slug is not null;

create table if not exists public.item_tags (
  item_id uuid not null references public.items (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (item_id, tag_id)
);

create index if not exists idx_item_tags_tag on public.item_tags (tag_id);
create index if not exists idx_item_tags_item on public.item_tags (item_id);

alter table public.item_tags enable row level security;

grant select on public.item_tags to authenticated;

create policy item_tags_select_authenticated on public.item_tags
for select to authenticated
using (
  exists (
    select 1 from public.items i
    where i.id = item_id and i.deleted_at is null
  )
);

create or replace function public.list_catalog_tags_v1()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'category', t.category,
        'label', t.label,
        'slug', t.slug,
        'reach_tier', t.reach_tier,
        'relevance_contexts', to_jsonb(t.relevance_contexts),
        'sort_order', t.sort_order,
        'page_kind', t.page_kind,
        'page_slug', t.page_slug,
        'item_count', (
          select count(*)::integer
          from public.item_tags it
          join public.items i on i.id = it.item_id and i.deleted_at is null
          where it.tag_id = t.id
        )
      )
      order by t.category asc, t.sort_order asc, t.label asc
    ),
    '[]'::jsonb
  )
  from public.tags t
  where t.is_active = true;
$$;

grant execute on function public.list_catalog_tags_v1() to authenticated;

create or replace function public.get_catalog_tag_page_v1(
  p_page_kind text,
  p_page_slug text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'label', t.label,
    'slug', t.slug,
    'category', t.category,
    'page_kind', t.page_kind,
    'page_slug', t.page_slug
  )
  from public.tags t
  where t.is_active = true
    and t.page_kind = p_page_kind
    and t.page_slug = p_page_slug
  limit 1;
$$;

grant execute on function public.get_catalog_tag_page_v1(text, text) to authenticated;

create or replace function public.get_shop_catalog_items_by_tag_page_slug(
  p_page_slug text,
  p_limit integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_tag_id uuid;
  v_limit integer;
  v_items jsonb;
  v_item_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  v_limit := greatest(1, least(coalesce(p_limit, 120), 200));

  select t.id into v_tag_id
  from public.tags t
  where t.is_active = true
    and t.page_kind = 'shop'
    and t.page_slug = trim(p_page_slug)
  limit 1;

  if v_tag_id is null then
    return jsonb_build_object('tag', null, 'items', '[]'::jsonb);
  end if;

  select coalesce(
    array_agg(it.item_id order by it.sort_order, it.item_id),
    array[]::uuid[]
  )
  into v_item_ids
  from public.item_tags it
  join public.items i on i.id = it.item_id and i.deleted_at is null
  where it.tag_id = v_tag_id;

  if cardinality(v_item_ids) = 0 then
    v_items := '[]'::jsonb;
  else
    v_items := coalesce(
      public.get_shop_catalog_items_by_ids(v_item_ids) -> 'items',
      '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'tag', public.get_catalog_tag_page_v1('shop', trim(p_page_slug)),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_shop_catalog_items_by_tag_page_slug(text, integer) to authenticated;

create or replace function public.get_community_inspirations_by_tag_page_slug(
  p_page_slug text,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_tag_id uuid;
  v_limit integer;
  v_cards jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  v_limit := greatest(1, least(coalesce(p_limit, 40), 80));

  select t.id into v_tag_id
  from public.tags t
  where t.is_active = true
    and t.page_kind = 'inspiration'
    and t.page_slug = trim(p_page_slug)
  limit 1;

  if v_tag_id is null then
    return jsonb_build_object('tag', null, 'cards', '[]'::jsonb);
  end if;

  with
  blocked as (
    select blocked_user_id from public.community_blocked_user_ids(v_uid)
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
      null::uuid as author_user_id,
      'Segna'::text as author_display_name,
      null::text as author_avatar_path,
      sl.like_count,
      sl.published_at,
      sl.created_at,
      slt.sort_order as tag_sort_order
    from public.style_look_tags slt
    join public.style_looks sl on sl.id = slt.look_id and sl.published = true
    where slt.tag_id = v_tag_id
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
      ci.author_user_id,
      coalesce(nullif(trim(up.display_name), ''), 'Membre Segna') as author_display_name,
      coalesce(up.photos->>'profile', up.avatar_url) as author_avatar_path,
      ci.like_count,
      ci.published_at,
      ci.created_at,
      cit.sort_order as tag_sort_order
    from public.community_inspiration_tags cit
    join public.community_inspirations ci on ci.id = cit.inspiration_id
      and ci.status = 'published' and ci.deleted_at is null
    left join public.user_profiles up on up.user_id = ci.author_user_id and up.deleted_at is null
    where cit.tag_id = v_tag_id
      and not exists (select 1 from blocked b where b.blocked_user_id = ci.author_user_id)
  ),
  merged as (
    select * from segna_rows
    union all
    select * from member_rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source', m.source,
        'id', m.id,
        'title', m.title,
        'caption', m.caption,
        'media_type', m.media_type,
        'media_bucket', m.media_bucket,
        'media_paths', m.media_paths,
        'video_poster_path', m.video_poster_path,
        'author_user_id', m.author_user_id,
        'author_display_name', m.author_display_name,
        'author_avatar_path', m.author_avatar_path,
        'like_count', m.like_count,
        'is_liked', exists (
          select 1 from public.inspiration_likes il
          where il.member_user_id = v_uid
            and il.source = m.source
            and il.inspiration_id = m.id
            and il.deleted_at is null
        ),
        'linked_item_count', 0,
        'preview_item_ids', '[]'::jsonb,
        'published_at', m.published_at
      )
      order by m.tag_sort_order asc, m.published_at desc nulls last, m.created_at desc
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select * from merged order by tag_sort_order asc, published_at desc nulls last, created_at desc limit v_limit
  ) m;

  return jsonb_build_object(
    'tag', public.get_catalog_tag_page_v1('inspiration', trim(p_page_slug)),
    'cards', coalesce(v_cards, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_community_inspirations_by_tag_page_slug(text, integer) to authenticated;
