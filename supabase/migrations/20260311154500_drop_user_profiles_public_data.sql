do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'public_data'
  ) then
    update public.user_profiles
    set profile_data = coalesce(profile_data, '{}'::jsonb) || coalesce(public_data, '{}'::jsonb);

    alter table public.user_profiles
      drop column public_data;
  end if;
end
$$;

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

grant execute on function public.update_user_profile_public(jsonb, uuid) to authenticated;
