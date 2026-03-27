-- Feed + recommendation foundations (V1)
-- Goals:
-- 1) Keep business tables as source of truth (item_favorites, cart_items)
-- 2) Add dedicated tracking for recommendation signals
-- 3) Store exposure history to control repetition in feed
-- 4) Prepare candidate/popularity layers for batch recommendation

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'feed_entity_type'
  ) then
    create type public.feed_entity_type as enum ('item', 'profile');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_interaction_type'
  ) then
    create type public.item_interaction_type as enum (
      'impression',
      'click',
      'view',
      'scroll',
      'dwell',
      'pass',
      'like',
      'unlike',
      'cart_add',
      'cart_remove'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'profile_interaction_type'
  ) then
    create type public.profile_interaction_type as enum (
      'impression',
      'click',
      'view',
      'scroll',
      'dwell',
      'pass',
      'like',
      'unlike',
      'dig'
    );
  end if;
end $$;

create table if not exists public.member_feed_impressions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.users(id) on delete cascade,
  entity_type public.feed_entity_type not null,
  item_id uuid null references public.items(id) on delete cascade,
  profile_user_id uuid null references public.users(id) on delete cascade,
  feed_surface text not null default 'home_v1',
  session_id uuid null,
  position integer null check (position is null or position >= 0),
  algorithm_version text null,
  segment_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (entity_type = 'item'::public.feed_entity_type and item_id is not null and profile_user_id is null)
    or
    (entity_type = 'profile'::public.feed_entity_type and profile_user_id is not null and item_id is null)
  )
);

create index if not exists member_feed_impressions_member_created_idx
  on public.member_feed_impressions (member_user_id, created_at desc);

create index if not exists member_feed_impressions_entity_item_idx
  on public.member_feed_impressions (item_id, created_at desc)
  where entity_type = 'item'::public.feed_entity_type;

create index if not exists member_feed_impressions_entity_profile_idx
  on public.member_feed_impressions (profile_user_id, created_at desc)
  where entity_type = 'profile'::public.feed_entity_type;

create table if not exists public.member_feed_entity_history (
  member_user_id uuid not null references public.users(id) on delete cascade,
  entity_type public.feed_entity_type not null,
  item_id uuid null references public.items(id) on delete cascade,
  profile_user_id uuid null references public.users(id) on delete cascade,
  entity_key text generated always as (
    case
      when entity_type = 'item'::public.feed_entity_type then item_id::text
      else profile_user_id::text
    end
  ) stored,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1 check (seen_count >= 1),
  last_entity_updated_at_at_seen timestamptz null,
  last_interaction_type text null,
  last_interaction_at timestamptz null,
  hidden_until timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (entity_type = 'item'::public.feed_entity_type and item_id is not null and profile_user_id is null)
    or
    (entity_type = 'profile'::public.feed_entity_type and profile_user_id is not null and item_id is null)
  ),
  primary key (member_user_id, entity_type, entity_key)
);

create index if not exists member_feed_entity_history_profile_replay_idx
  on public.member_feed_entity_history (
    member_user_id,
    profile_user_id,
    last_seen_at desc,
    last_entity_updated_at_at_seen
  )
  where entity_type = 'profile'::public.feed_entity_type;

create index if not exists member_feed_entity_history_item_replay_idx
  on public.member_feed_entity_history (
    member_user_id,
    item_id,
    last_seen_at desc
  )
  where entity_type = 'item'::public.feed_entity_type;

drop trigger if exists member_feed_entity_history_set_updated_at on public.member_feed_entity_history;
create trigger member_feed_entity_history_set_updated_at
before update on public.member_feed_entity_history
for each row execute function public.set_updated_at();

create table if not exists public.member_item_interactions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  interaction_type public.item_interaction_type not null,
  source_surface text not null default 'home_v1',
  session_id uuid null,
  impression_id uuid null references public.member_feed_impressions(id) on delete set null,
  dwell_ms integer null check (dwell_ms is null or dwell_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists member_item_interactions_member_created_idx
  on public.member_item_interactions (member_user_id, created_at desc);

create index if not exists member_item_interactions_item_created_idx
  on public.member_item_interactions (item_id, created_at desc);

create index if not exists member_item_interactions_type_created_idx
  on public.member_item_interactions (interaction_type, created_at desc);

create table if not exists public.member_profile_interactions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.users(id) on delete cascade,
  profile_user_id uuid not null references public.users(id) on delete cascade,
  interaction_type public.profile_interaction_type not null,
  source_surface text not null default 'home_v1',
  session_id uuid null,
  impression_id uuid null references public.member_feed_impressions(id) on delete set null,
  dwell_ms integer null check (dwell_ms is null or dwell_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (member_user_id <> profile_user_id)
);

create index if not exists member_profile_interactions_member_created_idx
  on public.member_profile_interactions (member_user_id, created_at desc);

create index if not exists member_profile_interactions_profile_created_idx
  on public.member_profile_interactions (profile_user_id, created_at desc);

create index if not exists member_profile_interactions_type_created_idx
  on public.member_profile_interactions (interaction_type, created_at desc);

create table if not exists public.reco_candidates (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.users(id) on delete cascade,
  entity_type public.feed_entity_type not null,
  item_id uuid null references public.items(id) on delete cascade,
  profile_user_id uuid null references public.users(id) on delete cascade,
  source text not null,
  score numeric(12, 6) not null default 0,
  rank_position integer null check (rank_position is null or rank_position > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (entity_type = 'item'::public.feed_entity_type and item_id is not null and profile_user_id is null)
    or
    (entity_type = 'profile'::public.feed_entity_type and profile_user_id is not null and item_id is null)
  )
);

create index if not exists reco_candidates_member_valid_idx
  on public.reco_candidates (member_user_id, valid_from desc, valid_to);

create index if not exists reco_candidates_source_idx
  on public.reco_candidates (source, created_at desc);

create table if not exists public.reco_popularity_daily (
  day date not null,
  segment_key text not null,
  entity_type public.feed_entity_type not null,
  item_id uuid null references public.items(id) on delete cascade,
  profile_user_id uuid null references public.users(id) on delete cascade,
  entity_key text generated always as (
    coalesce(item_id::text, profile_user_id::text)
  ) stored,
  impressions_count integer not null default 0 check (impressions_count >= 0),
  likes_count integer not null default 0 check (likes_count >= 0),
  pass_count integer not null default 0 check (pass_count >= 0),
  cart_add_count integer not null default 0 check (cart_add_count >= 0),
  dig_count integer not null default 0 check (dig_count >= 0),
  total_dwell_ms bigint not null default 0 check (total_dwell_ms >= 0),
  updated_at timestamptz not null default now(),
  check (
    (entity_type = 'item'::public.feed_entity_type and item_id is not null and profile_user_id is null)
    or
    (entity_type = 'profile'::public.feed_entity_type and profile_user_id is not null and item_id is null)
  ),
  primary key (day, segment_key, entity_type, entity_key)
);

create index if not exists reco_popularity_daily_segment_day_idx
  on public.reco_popularity_daily (segment_key, day desc);

create or replace function public.member_feed_entity_history_upsert_on_impression()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_updated_at timestamptz;
begin
  if new.entity_type = 'item'::public.feed_entity_type then
    select i.updated_at into v_entity_updated_at
    from public.items i
    where i.id = new.item_id;
  else
    select up.updated_at into v_entity_updated_at
    from public.user_profiles up
    where up.user_id = new.profile_user_id;
  end if;

  insert into public.member_feed_entity_history (
    member_user_id,
    entity_type,
    item_id,
    profile_user_id,
    first_seen_at,
    last_seen_at,
    seen_count,
    last_entity_updated_at_at_seen
  )
  values (
    new.member_user_id,
    new.entity_type,
    new.item_id,
    new.profile_user_id,
    new.created_at,
    new.created_at,
    1,
    v_entity_updated_at
  )
  on conflict (member_user_id, entity_type, entity_key) do update
  set last_seen_at = excluded.last_seen_at,
      seen_count = public.member_feed_entity_history.seen_count + 1,
      last_entity_updated_at_at_seen = excluded.last_entity_updated_at_at_seen;

  return new;
end;
$$;

drop trigger if exists trg_member_feed_impressions_upsert_history on public.member_feed_impressions;
create trigger trg_member_feed_impressions_upsert_history
after insert on public.member_feed_impressions
for each row execute function public.member_feed_entity_history_upsert_on_impression();

create or replace function public.member_feed_entity_history_touch_item_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_feed_entity_history (
    member_user_id,
    entity_type,
    item_id,
    profile_user_id,
    first_seen_at,
    last_seen_at,
    seen_count,
    last_interaction_type,
    last_interaction_at
  )
  values (
    new.member_user_id,
    'item'::public.feed_entity_type,
    new.item_id,
    null,
    new.created_at,
    new.created_at,
    1,
    new.interaction_type::text,
    new.created_at
  )
  on conflict (member_user_id, entity_type, entity_key) do update
  set last_interaction_type = excluded.last_interaction_type,
      last_interaction_at = excluded.last_interaction_at;

  return new;
end;
$$;

drop trigger if exists trg_member_item_interactions_touch_history on public.member_item_interactions;
create trigger trg_member_item_interactions_touch_history
after insert on public.member_item_interactions
for each row execute function public.member_feed_entity_history_touch_item_interaction();

create or replace function public.member_feed_entity_history_touch_profile_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_feed_entity_history (
    member_user_id,
    entity_type,
    item_id,
    profile_user_id,
    first_seen_at,
    last_seen_at,
    seen_count,
    last_interaction_type,
    last_interaction_at
  )
  values (
    new.member_user_id,
    'profile'::public.feed_entity_type,
    null,
    new.profile_user_id,
    new.created_at,
    new.created_at,
    1,
    new.interaction_type::text,
    new.created_at
  )
  on conflict (member_user_id, entity_type, entity_key) do update
  set last_interaction_type = excluded.last_interaction_type,
      last_interaction_at = excluded.last_interaction_at;

  return new;
end;
$$;

drop trigger if exists trg_member_profile_interactions_touch_history on public.member_profile_interactions;
create trigger trg_member_profile_interactions_touch_history
after insert on public.member_profile_interactions
for each row execute function public.member_feed_entity_history_touch_profile_interaction();

create or replace function public.record_member_feed_impression(
  p_entity_type public.feed_entity_type,
  p_item_id uuid default null,
  p_profile_user_id uuid default null,
  p_feed_surface text default 'home_v1',
  p_session_id uuid default null,
  p_position integer default null,
  p_algorithm_version text default null,
  p_segment_snapshot jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.member_feed_impressions (
    member_user_id,
    entity_type,
    item_id,
    profile_user_id,
    feed_surface,
    session_id,
    position,
    algorithm_version,
    segment_snapshot,
    metadata
  )
  values (
    v_uid,
    p_entity_type,
    p_item_id,
    p_profile_user_id,
    coalesce(nullif(p_feed_surface, ''), 'home_v1'),
    p_session_id,
    p_position,
    p_algorithm_version,
    coalesce(p_segment_snapshot, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_member_item_interaction(
  p_item_id uuid,
  p_interaction_type public.item_interaction_type,
  p_source_surface text default 'home_v1',
  p_session_id uuid default null,
  p_impression_id uuid default null,
  p_dwell_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.member_item_interactions (
    member_user_id,
    item_id,
    interaction_type,
    source_surface,
    session_id,
    impression_id,
    dwell_ms,
    metadata
  )
  values (
    v_uid,
    p_item_id,
    p_interaction_type,
    coalesce(nullif(p_source_surface, ''), 'home_v1'),
    p_session_id,
    p_impression_id,
    p_dwell_ms,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_member_profile_interaction(
  p_profile_user_id uuid,
  p_interaction_type public.profile_interaction_type,
  p_source_surface text default 'home_v1',
  p_session_id uuid default null,
  p_impression_id uuid default null,
  p_dwell_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_uid = p_profile_user_id then
    raise exception 'Cannot interact with own profile';
  end if;

  insert into public.member_profile_interactions (
    member_user_id,
    profile_user_id,
    interaction_type,
    source_surface,
    session_id,
    impression_id,
    dwell_ms,
    metadata
  )
  values (
    v_uid,
    p_profile_user_id,
    p_interaction_type,
    coalesce(nullif(p_source_surface, ''), 'home_v1'),
    p_session_id,
    p_impression_id,
    p_dwell_ms,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.is_profile_eligible_for_home_feed(
  p_member_user_id uuid,
  p_profile_user_id uuid,
  p_min_days_since_last_seen integer default 30
)
returns boolean
language sql
stable
set search_path = public
as $$
  with h as (
    select
      x.last_seen_at,
      x.last_entity_updated_at_at_seen
    from public.member_feed_entity_history x
    where x.member_user_id = p_member_user_id
      and x.entity_type = 'profile'::public.feed_entity_type
      and x.profile_user_id = p_profile_user_id
    limit 1
  ),
  p as (
    select up.updated_at
    from public.user_profiles up
    where up.user_id = p_profile_user_id
      and up.deleted_at is null
    limit 1
  )
  select
    case
      when p_member_user_id is null
        or p_profile_user_id is null
        or p_member_user_id = p_profile_user_id
      then false
      when not exists (select 1 from p)
      then false
      when not exists (select 1 from h)
      then true
      when now() < ((select h.last_seen_at from h) + make_interval(days => greatest(1, p_min_days_since_last_seen)))
      then false
      when (select p.updated_at from p) <= coalesce(
        (select h.last_entity_updated_at_at_seen from h),
        (select h.last_seen_at from h)
      )
      then false
      else true
    end;
$$;

create or replace function public.member_item_interactions_from_business_tables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'item_favorites' then
    if tg_op = 'INSERT' then
      insert into public.member_item_interactions (member_user_id, item_id, interaction_type, source_surface, metadata)
      values (new.user_id, new.item_id, 'like', 'catalog', jsonb_build_object('source_table', 'item_favorites'));
      return new;
    end if;

    if tg_op = 'UPDATE' then
      if old.deleted_at is null and new.deleted_at is not null then
        insert into public.member_item_interactions (member_user_id, item_id, interaction_type, source_surface, metadata)
        values (new.user_id, new.item_id, 'unlike', 'catalog', jsonb_build_object('source_table', 'item_favorites'));
      elsif old.deleted_at is not null and new.deleted_at is null then
        insert into public.member_item_interactions (member_user_id, item_id, interaction_type, source_surface, metadata)
        values (new.user_id, new.item_id, 'like', 'catalog', jsonb_build_object('source_table', 'item_favorites'));
      end if;
      return new;
    end if;
  end if;

  if tg_table_name = 'cart_items' then
    if tg_op = 'INSERT' then
      if new.deleted_at is null then
        insert into public.member_item_interactions (member_user_id, item_id, interaction_type, source_surface, metadata)
        values (
          (select c.user_id from public.carts c where c.id = new.cart_id),
          new.item_id,
          'cart_add',
          'cart',
          jsonb_build_object('source_table', 'cart_items', 'status', new.status)
        );
      end if;
      return new;
    end if;

    if tg_op = 'UPDATE' then
      if old.deleted_at is null and new.deleted_at is not null then
        insert into public.member_item_interactions (member_user_id, item_id, interaction_type, source_surface, metadata)
        values (
          (select c.user_id from public.carts c where c.id = new.cart_id),
          new.item_id,
          'cart_remove',
          'cart',
          jsonb_build_object('source_table', 'cart_items', 'status', new.status)
        );
      elsif old.deleted_at is not null and new.deleted_at is null then
        insert into public.member_item_interactions (member_user_id, item_id, interaction_type, source_surface, metadata)
        values (
          (select c.user_id from public.carts c where c.id = new.cart_id),
          new.item_id,
          'cart_add',
          'cart',
          jsonb_build_object('source_table', 'cart_items', 'status', new.status)
        );
      end if;
      return new;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_item_favorites_to_member_item_interactions on public.item_favorites;
create trigger trg_item_favorites_to_member_item_interactions
after insert or update on public.item_favorites
for each row execute function public.member_item_interactions_from_business_tables();

drop trigger if exists trg_cart_items_to_member_item_interactions on public.cart_items;
create trigger trg_cart_items_to_member_item_interactions
after insert or update on public.cart_items
for each row execute function public.member_item_interactions_from_business_tables();

alter table public.member_feed_impressions enable row level security;
alter table public.member_feed_entity_history enable row level security;
alter table public.member_item_interactions enable row level security;
alter table public.member_profile_interactions enable row level security;
alter table public.reco_candidates enable row level security;
alter table public.reco_popularity_daily enable row level security;

drop policy if exists member_feed_impressions_select on public.member_feed_impressions;
create policy member_feed_impressions_select
on public.member_feed_impressions
for select
to authenticated
using (member_user_id = auth.uid() or is_staff());

drop policy if exists member_feed_impressions_insert on public.member_feed_impressions;
create policy member_feed_impressions_insert
on public.member_feed_impressions
for insert
to authenticated
with check (member_user_id = auth.uid() or is_staff());

drop policy if exists member_feed_entity_history_select on public.member_feed_entity_history;
create policy member_feed_entity_history_select
on public.member_feed_entity_history
for select
to authenticated
using (member_user_id = auth.uid() or is_staff());

drop policy if exists member_item_interactions_select on public.member_item_interactions;
create policy member_item_interactions_select
on public.member_item_interactions
for select
to authenticated
using (member_user_id = auth.uid() or is_staff());

drop policy if exists member_item_interactions_insert on public.member_item_interactions;
create policy member_item_interactions_insert
on public.member_item_interactions
for insert
to authenticated
with check (member_user_id = auth.uid() or is_staff());

drop policy if exists member_profile_interactions_select on public.member_profile_interactions;
create policy member_profile_interactions_select
on public.member_profile_interactions
for select
to authenticated
using (member_user_id = auth.uid() or is_staff());

drop policy if exists member_profile_interactions_insert on public.member_profile_interactions;
create policy member_profile_interactions_insert
on public.member_profile_interactions
for insert
to authenticated
with check (member_user_id = auth.uid() or is_staff());

drop policy if exists reco_candidates_select on public.reco_candidates;
create policy reco_candidates_select
on public.reco_candidates
for select
to authenticated
using (member_user_id = auth.uid() or is_staff());

drop policy if exists reco_candidates_insert_staff on public.reco_candidates;
create policy reco_candidates_insert_staff
on public.reco_candidates
for insert
to authenticated
with check (is_staff());

drop policy if exists reco_popularity_daily_select_staff on public.reco_popularity_daily;
create policy reco_popularity_daily_select_staff
on public.reco_popularity_daily
for select
to authenticated
using (is_staff());

grant select, insert on public.member_feed_impressions to authenticated;
grant select on public.member_feed_entity_history to authenticated;
grant select, insert on public.member_item_interactions to authenticated;
grant select, insert on public.member_profile_interactions to authenticated;
grant select on public.reco_candidates to authenticated;
grant select on public.reco_popularity_daily to authenticated;

grant execute on function public.record_member_feed_impression(
  public.feed_entity_type,
  uuid,
  uuid,
  text,
  uuid,
  integer,
  text,
  jsonb,
  jsonb
) to authenticated;

grant execute on function public.record_member_item_interaction(
  uuid,
  public.item_interaction_type,
  text,
  uuid,
  uuid,
  integer,
  jsonb
) to authenticated;

grant execute on function public.record_member_profile_interaction(
  uuid,
  public.profile_interaction_type,
  text,
  uuid,
  uuid,
  integer,
  jsonb
) to authenticated;

grant execute on function public.is_profile_eligible_for_home_feed(uuid, uuid, integer) to authenticated;
