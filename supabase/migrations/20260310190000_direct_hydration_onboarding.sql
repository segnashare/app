create extension if not exists "pgcrypto";

alter table public.user_profiles
  add column if not exists profile_data jsonb not null default '{}'::jsonb,
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists looks jsonb not null default '[]'::jsonb,
  add column if not exists answers jsonb not null default '[]'::jsonb;

update public.user_profiles
set
  profile_data = coalesce(profile_data, '{}'::jsonb),
  preferences = coalesce(preferences, '{}'::jsonb),
  looks = coalesce(looks, '[]'::jsonb),
  answers = coalesce(answers, '[]'::jsonb)
where
  profile_data is null
  or preferences is null
  or looks is null
  or answers is null;

alter table public.user_profiles
  alter column profile_data set default '{}'::jsonb,
  alter column profile_data set not null,
  alter column preferences set default '{}'::jsonb,
  alter column preferences set not null,
  alter column looks set default '[]'::jsonb,
  alter column looks set not null,
  alter column answers set default '[]'::jsonb,
  alter column answers set not null;

create table if not exists public.user_profile_brands (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  brand_id uuid not null references public.item_brands(id) on delete cascade,
  rank smallint not null,
  created_at timestamptz not null default now(),
  unique (user_profile_id, brand_id),
  unique (user_profile_id, rank)
);

create table if not exists public.user_profile_sizes (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  category text not null check (category in ('top', 'bottom', 'shoes')),
  size_id uuid not null references public.item_sizes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_profile_id, category)
);

alter table public.user_profile_brands enable row level security;
alter table public.user_profile_sizes enable row level security;

drop policy if exists "user_profile_brands_select_own" on public.user_profile_brands;
create policy "user_profile_brands_select_own"
on public.user_profile_brands
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_brands.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_brands_insert_own" on public.user_profile_brands;
create policy "user_profile_brands_insert_own"
on public.user_profile_brands
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_brands.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_brands_update_own" on public.user_profile_brands;
create policy "user_profile_brands_update_own"
on public.user_profile_brands
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_brands.user_profile_id
      and up.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_brands.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_brands_delete_own" on public.user_profile_brands;
create policy "user_profile_brands_delete_own"
on public.user_profile_brands
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_brands.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_sizes_select_own" on public.user_profile_sizes;
create policy "user_profile_sizes_select_own"
on public.user_profile_sizes
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_sizes.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_sizes_insert_own" on public.user_profile_sizes;
create policy "user_profile_sizes_insert_own"
on public.user_profile_sizes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_sizes.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_sizes_update_own" on public.user_profile_sizes;
create policy "user_profile_sizes_update_own"
on public.user_profile_sizes
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_sizes.user_profile_id
      and up.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_sizes.user_profile_id
      and up.user_id = auth.uid()
  )
);

drop policy if exists "user_profile_sizes_delete_own" on public.user_profile_sizes;
create policy "user_profile_sizes_delete_own"
on public.user_profile_sizes
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = user_profile_sizes.user_profile_id
      and up.user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.user_profile_brands to authenticated;
grant select, insert, update, delete on public.user_profile_sizes to authenticated;

create or replace function public.update_user_profile_public(
  p_profile_json jsonb,
  p_request_id uuid default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_profiles;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_profiles
  set
    display_name = coalesce(p_profile_json->>'display_name', display_name),
    bio = coalesce(p_profile_json->>'bio', bio),
    avatar_url = coalesce(p_profile_json->>'avatar_url', avatar_url),
    photos = case
      when p_profile_json ? 'photos' then coalesce(p_profile_json->'photos', photos)
      else photos
    end,
    profile_data = case
      when p_profile_json ? 'profile_data' then coalesce(profile_data, '{}'::jsonb) || coalesce(p_profile_json->'profile_data', '{}'::jsonb)
      else profile_data
    end,
    preferences = case
      when p_profile_json ? 'preferences' then coalesce(preferences, '{}'::jsonb) || coalesce(p_profile_json->'preferences', '{}'::jsonb)
      else preferences
    end,
    looks = case
      when p_profile_json ? 'looks' then coalesce(p_profile_json->'looks', looks)
      else looks
    end,
    answers = case
      when p_profile_json ? 'answers' then coalesce(p_profile_json->'answers', answers)
      else answers
    end
  where user_id = v_uid
  returning * into v_row;

  perform public.log_activity_event(
    p_event_name => 'update_user_profile_public',
    p_payload => coalesce(p_profile_json, '{}'::jsonb),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

create or replace function public.set_user_profile_brands(
  p_brand_ids uuid[],
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_user_profile_id uuid;
  v_kept_brand_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select id
  into v_user_profile_id
  from public.user_profiles
  where user_id = v_uid;

  with normalized as (
    select brand_id, ordinality
    from unnest(coalesce(p_brand_ids, '{}'::uuid[])) with ordinality as t(brand_id, ordinality)
    where brand_id is not null
  ),
  deduped as (
    select distinct on (brand_id) brand_id, ordinality
    from normalized
    order by brand_id, ordinality
  ),
  limited as (
    select brand_id, ordinality
    from deduped
    order by ordinality
    limit 3
  )
  select coalesce(array_agg(brand_id order by ordinality), '{}'::uuid[])
  into v_kept_brand_ids
  from limited;

  delete from public.user_profile_brands
  where user_profile_id = v_user_profile_id;

  insert into public.user_profile_brands (user_profile_id, brand_id, rank)
  select
    v_user_profile_id,
    brand_id,
    row_number() over (order by ordinality)::smallint
  from (
    select brand_id, ordinality
    from unnest(v_kept_brand_ids) with ordinality as t(brand_id, ordinality)
  ) ranked;

  perform public.log_activity_event(
    p_event_name => 'set_user_profile_brands',
    p_payload => jsonb_build_object('brand_ids', to_jsonb(v_kept_brand_ids)),
    p_request_id => p_request_id
  );

  return jsonb_build_object('brand_ids', to_jsonb(v_kept_brand_ids));
end;
$$;

create or replace function public.set_user_profile_sizes(
  p_top_size_code text,
  p_bottom_size_code text,
  p_shoes_size_code text,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_user_profile_id uuid;
  v_top_size_code text := nullif(trim(p_top_size_code), '');
  v_bottom_size_code text := nullif(trim(p_bottom_size_code), '');
  v_shoes_size_code text := nullif(trim(p_shoes_size_code), '');
  v_top_size_id uuid;
  v_bottom_size_id uuid;
  v_shoes_size_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select id
  into v_user_profile_id
  from public.user_profiles
  where user_id = v_uid;

  if v_top_size_code is not null then
    select id into v_top_size_id
    from public.item_sizes
    where code = v_top_size_code
    limit 1;
    if v_top_size_id is null then
      raise exception 'Unknown top size code: %', v_top_size_code;
    end if;
  end if;

  if v_bottom_size_code is not null then
    select id into v_bottom_size_id
    from public.item_sizes
    where code = v_bottom_size_code
    limit 1;
    if v_bottom_size_id is null then
      raise exception 'Unknown bottom size code: %', v_bottom_size_code;
    end if;
  end if;

  if v_shoes_size_code is not null then
    select id into v_shoes_size_id
    from public.item_sizes
    where code = v_shoes_size_code
    limit 1;
    if v_shoes_size_id is null then
      raise exception 'Unknown shoes size code: %', v_shoes_size_code;
    end if;
  end if;

  delete from public.user_profile_sizes
  where user_profile_id = v_user_profile_id
    and category in ('top', 'bottom', 'shoes');

  insert into public.user_profile_sizes (user_profile_id, category, size_id)
  select v_user_profile_id, category, size_id
  from (
    select 'top'::text as category, v_top_size_id as size_id
    union all
    select 'bottom'::text as category, v_bottom_size_id as size_id
    union all
    select 'shoes'::text as category, v_shoes_size_id as size_id
  ) s
  where size_id is not null;

  perform public.log_activity_event(
    p_event_name => 'set_user_profile_sizes',
    p_payload => jsonb_build_object(
      'top_size_code', v_top_size_code,
      'bottom_size_code', v_bottom_size_code,
      'shoes_size_code', v_shoes_size_code
    ),
    p_request_id => p_request_id
  );

  return jsonb_build_object(
    'top_size_code', v_top_size_code,
    'bottom_size_code', v_bottom_size_code,
    'shoes_size_code', v_shoes_size_code
  );
end;
$$;

create or replace function public.get_profile_preference_visibility()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_preferences jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select preferences
  into v_preferences
  from public.user_profiles
  where user_id = v_uid;

  return jsonb_build_object(
    'style_visible', coalesce((v_preferences #>> '{style,visible}')::boolean, true),
    'brands_visible', coalesce((v_preferences #>> '{brands,visible}')::boolean, true),
    'motivation_visible', coalesce((v_preferences #>> '{motivation,visible}')::boolean, true),
    'experience_visible', coalesce((v_preferences #>> '{experience,visible}')::boolean, true),
    'share_visible', coalesce((v_preferences #>> '{share,visible}')::boolean, true),
    'budget_visible', coalesce((v_preferences #>> '{budget,visible}')::boolean, true),
    'dressing_visible', coalesce((v_preferences #>> '{dressing,visible}')::boolean, true),
    'ethic_visible', coalesce((v_preferences #>> '{ethic,visible}')::boolean, true),
    'privacy_visible', coalesce((v_preferences #>> '{privacy,visible}')::boolean, true),
    'looks_visible', coalesce((v_preferences #>> '{looks,visible}')::boolean, true),
    'answers_visible', coalesce((v_preferences #>> '{answers,visible}')::boolean, true)
  );
end;
$$;

create or replace function public.set_profile_preference_visibility(
  p_section text,
  p_visible boolean,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_section text;
  v_section_payload jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_section := lower(trim(p_section));
  if v_section not in (
    'style',
    'brands',
    'motivation',
    'experience',
    'share',
    'budget',
    'dressing',
    'ethic',
    'privacy',
    'looks',
    'answers'
  ) then
    raise exception 'Invalid section %', p_section;
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select coalesce(preferences -> v_section, '{}'::jsonb)
  into v_section_payload
  from public.user_profiles
  where user_id = v_uid;

  if jsonb_typeof(v_section_payload) is distinct from 'object' then
    v_section_payload := '{}'::jsonb;
  end if;

  update public.user_profiles
  set preferences = jsonb_set(
    coalesce(preferences, '{}'::jsonb),
    array[v_section],
    v_section_payload || jsonb_build_object('visible', p_visible),
    true
  )
  where user_id = v_uid;

  perform public.log_activity_event(
    p_event_name => 'set_profile_preference_visibility',
    p_payload => jsonb_build_object('section', v_section, 'visible', p_visible),
    p_request_id => p_request_id
  );

  return public.get_profile_preference_visibility();
end;
$$;

grant execute on function public.update_user_profile_public(jsonb, uuid) to authenticated;
grant execute on function public.set_user_profile_brands(uuid[], uuid) to authenticated;
grant execute on function public.set_user_profile_sizes(text, text, text, uuid) to authenticated;
grant execute on function public.get_profile_preference_visibility() to authenticated;
grant execute on function public.set_profile_preference_visibility(text, boolean, uuid) to authenticated;
