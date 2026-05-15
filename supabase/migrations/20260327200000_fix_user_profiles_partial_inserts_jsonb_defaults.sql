-- Inserts partiels sur user_profiles (user_id + 1–2 colonnes) : sur certaines bases,
-- profile_data / preferences / looks / answers peuvent rester NULL → 23502 (ex. 20260328100000).
-- Doit s’exécuter avant le bootstrap corporate ; pas de dépendance à format_display_name_from_names (604031).

create or replace function public.sync_user_profile_display_name_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if nullif(trim(coalesce(new.first_name, '')), '') is not null
     and nullif(trim(coalesce(new.last_name, '')), '') is not null then
    v_display_name := trim(new.first_name) || ' ' || upper(left(trim(new.last_name), 1)) || '.';
  else
    v_display_name := null;
  end if;

  insert into public.user_profiles (
    user_id,
    display_name,
    photos,
    profile_data,
    preferences,
    looks,
    answers
  )
  values (
    new.id,
    v_display_name,
    '[]'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name;

  return new;
end;
$$;

create or replace function public.sync_user_profile_age_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_age integer;
begin
  if new.birth_date is null then
    v_age := null;
  else
    v_age := extract(year from age(current_date, new.birth_date))::integer;
  end if;

  insert into public.user_profiles (
    user_id,
    age,
    photos,
    profile_data,
    preferences,
    looks,
    answers
  )
  values (
    new.id,
    v_age,
    '[]'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )
  on conflict (user_id) do update
  set age = excluded.age;

  return new;
end;
$$;

create or replace function public.set_user_location(
  p_adress text,
  p_timezone text default null,
  p_relative_city text default null,
  p_request_id uuid default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.users;
  v_adress text;
  v_timezone text;
  v_relative_city text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_adress := nullif(trim(p_adress), '');
  if v_adress is null then
    raise exception 'Address is required';
  end if;

  v_timezone := coalesce(nullif(trim(p_timezone), ''), 'Europe/Paris');
  v_relative_city := nullif(trim(p_relative_city), '');

  insert into public.users (id, adress, timezone)
  values (v_uid, v_adress, v_timezone)
  on conflict (id) do update
  set adress = excluded.adress,
      timezone = coalesce(excluded.timezone, public.users.timezone)
  returning * into v_row;

  insert into public.user_profiles (
    user_id,
    city,
    photos,
    profile_data,
    preferences,
    looks,
    answers
  )
  values (
    v_uid,
    v_relative_city,
    '[]'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )
  on conflict (user_id) do update
  set city = coalesce(excluded.city, public.user_profiles.city);

  perform public.log_activity_event(
    p_event_name => 'set_user_location',
    p_payload => jsonb_build_object(
      'adress', v_adress,
      'timezone', v_timezone,
      'city', v_relative_city
    ),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;
