create or replace function public.get_user_preferences_payload()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_profile_id uuid;
  v_row public.user_preferences%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select id
  into v_profile_id
  from public.user_profiles
  where user_id = v_uid;

  insert into public.user_preferences (user_profile_id)
  values (v_profile_id)
  on conflict (user_profile_id) do nothing;

  select *
  into v_row
  from public.user_preferences
  where user_profile_id = v_profile_id;

  return jsonb_build_object(
    'style', coalesce(v_row.style, '{}'::jsonb),
    'brands', coalesce(v_row.brands, '{}'::jsonb),
    'motivation', coalesce(v_row.motivation, '{}'::jsonb),
    'experience', coalesce(v_row.experience, '{}'::jsonb),
    'share', coalesce(v_row.share, '{}'::jsonb),
    'budget', coalesce(v_row.budget, '{}'::jsonb),
    'dressing', coalesce(v_row.dressing, '{}'::jsonb),
    'ethic', coalesce(v_row.ethic, '{}'::jsonb),
    'privacy', coalesce(v_row.privacy, '{}'::jsonb)
  );
end;
$$;

create or replace function public.update_user_profile_public(p_profile_json jsonb, p_request_id uuid default null::uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_profiles;
  v_profile_id uuid;
  v_preferences jsonb;
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
    looks = case
      when p_profile_json ? 'looks' then coalesce(p_profile_json->'looks', looks)
      else looks
    end,
    answers = case
      when p_profile_json ? 'answers' then coalesce(p_profile_json->'answers', answers)
      else answers
    end,
    updated_at = timezone('utc', now())
  where user_id = v_uid
  returning * into v_row;

  v_profile_id := v_row.id;
  v_preferences := coalesce(p_profile_json->'preferences', '{}'::jsonb);

  if p_profile_json ? 'preferences' then
    insert into public.user_preferences (user_profile_id)
    values (v_profile_id)
    on conflict (user_profile_id) do nothing;

    update public.user_preferences
    set
      style = case
        when v_preferences ? 'style' then public.normalize_preference_payload(v_preferences->'style', coalesce(style #> '{preference,value}', 'null'::jsonb))
        else style
      end,
      brands = case
        when v_preferences ? 'brands' then public.normalize_preference_payload(v_preferences->'brands', coalesce(brands #> '{preference,value}', '[]'::jsonb))
        else brands
      end,
      motivation = case
        when v_preferences ? 'motivation' then public.normalize_preference_payload(v_preferences->'motivation', coalesce(motivation #> '{preference,value}', 'null'::jsonb))
        else motivation
      end,
      experience = case
        when v_preferences ? 'experience' then public.normalize_preference_payload(v_preferences->'experience', coalesce(experience #> '{preference,value}', 'null'::jsonb))
        else experience
      end,
      share = case
        when v_preferences ? 'share' then public.normalize_preference_payload(v_preferences->'share', coalesce(share #> '{preference,value}', 'null'::jsonb))
        else share
      end,
      budget = case
        when v_preferences ? 'budget' then public.normalize_preference_payload(v_preferences->'budget', coalesce(budget #> '{preference,value}', 'null'::jsonb))
        else budget
      end,
      dressing = case
        when v_preferences ? 'dressing' then public.normalize_preference_payload(v_preferences->'dressing', coalesce(dressing #> '{preference,value}', 'null'::jsonb))
        else dressing
      end,
      ethic = case
        when v_preferences ? 'ethic' then public.normalize_preference_payload(v_preferences->'ethic', coalesce(ethic #> '{preference,value}', 'null'::jsonb))
        else ethic
      end,
      privacy = case
        when v_preferences ? 'privacy' then public.normalize_preference_payload(v_preferences->'privacy', coalesce(privacy #> '{preference,value}', 'null'::jsonb))
        else privacy
      end,
      updated_at = timezone('utc', now())
    where user_profile_id = v_profile_id;
  end if;

  perform public.log_activity_event(
    p_event_name => 'update_user_profile_public',
    p_payload => coalesce(p_profile_json, '{}'::jsonb),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;
