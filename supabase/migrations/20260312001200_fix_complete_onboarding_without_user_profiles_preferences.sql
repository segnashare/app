create or replace function public.complete_onboarding(
  p_answers_json jsonb default '{}'::jsonb,
  p_visibility_json jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns public.onboarding_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.onboarding_sessions;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_profiles
  set profile_data = coalesce(profile_data, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'location', case when p_answers_json ? 'location' then p_answers_json->'location' end,
          'sizes',    case when p_answers_json ? 'size' then p_answers_json->'size' end,
          'work',     case when p_answers_json ? 'work' then p_answers_json->'work' end
        )
      ),
      looks = case when p_answers_json ? 'looks' and jsonb_typeof(p_answers_json->'looks') = 'array'
                   then p_answers_json->'looks' else looks end,
      answers = case when p_answers_json ? 'answers' and jsonb_typeof(p_answers_json->'answers') = 'array'
                     then p_answers_json->'answers' else answers end
  where user_id = v_uid;

  update public.onboarding_sessions
  set status = 'completed',
      completed_at = now(),
      current_step = '/onboarding/end',
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object('checkpoint', '/onboarding/end')
  where user_id = v_uid
  returning * into v_row;

  if not found then
    insert into public.onboarding_sessions (user_id, status, current_step, progress, completed_at)
    values (v_uid, 'completed', '/onboarding/end', jsonb_build_object('checkpoint', '/onboarding/end'), now())
    returning * into v_row;
  end if;

  update public.users
  set status = 'active',
      onboarding_completed_at = now()
  where id = v_uid;

  perform public.log_activity_event(
    'complete_onboarding',
    jsonb_build_object('answers', coalesce(p_answers_json, '{}'::jsonb), 'visibility', coalesce(p_visibility_json, '{}'::jsonb)),
    p_request_id
  );

  return v_row;
end;
$$;
