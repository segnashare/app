alter table public.users
  add column if not exists adress text;

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

  insert into public.user_profiles (user_id, city)
  values (v_uid, v_relative_city)
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

grant execute on function public.set_user_location(text, text, text, uuid) to authenticated;
