create or replace function public.xp_safe_numeric(p_text text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_clean text;
begin
  v_clean := nullif(trim(coalesce(p_text, '')), '');
  if v_clean is null then
    return null;
  end if;
  begin
    return v_clean::numeric;
  exception
    when others then
      return null;
  end;
end;
$$;

create or replace function public.xp_onboarding_completed_hook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    begin
      perform public.xp_award_action(
        p_action_code := 'xp_onboarding_first_app_open',
        p_source_type := 'onboarding',
        p_source_id := coalesce(new.current_step, '/onboarding/end'),
        p_idempotency_key := format('xp_onboarding_first_app_open:%s', new.user_id::text),
        p_metadata := jsonb_build_object(
          'trigger', 'onboarding_sessions.status.completed',
          'current_step', new.current_step
        ),
        p_request_id := null
      );
    exception
      when undefined_function then
        null;
      when others then
        null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_xp_onboarding_completed_hook on public.onboarding_sessions;
create trigger trg_xp_onboarding_completed_hook
after insert or update on public.onboarding_sessions
for each row
execute function public.xp_onboarding_completed_hook();

create or replace function public.xp_user_profile_score_100_hook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_json jsonb;
  v_old_json jsonb;
  v_new_score numeric;
  v_old_score numeric;
begin
  v_new_json := to_jsonb(new);
  v_old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  v_new_score := coalesce(
    public.xp_safe_numeric(v_new_json->>'score'),
    public.xp_safe_numeric(v_new_json->>'completion_score'),
    public.xp_safe_numeric(v_new_json #>> '{profile_data,completion_score}'),
    public.xp_safe_numeric(v_new_json #>> '{profile_data,profile_completion}'),
    public.xp_safe_numeric(v_new_json #>> '{profile_data,progress_score}')
  );

  v_old_score := coalesce(
    public.xp_safe_numeric(v_old_json->>'score'),
    public.xp_safe_numeric(v_old_json->>'completion_score'),
    public.xp_safe_numeric(v_old_json #>> '{profile_data,completion_score}'),
    public.xp_safe_numeric(v_old_json #>> '{profile_data,profile_completion}'),
    public.xp_safe_numeric(v_old_json #>> '{profile_data,progress_score}')
  );

  if coalesce(v_new_score, 0) >= 100 and coalesce(v_old_score, 0) < 100 then
    begin
      perform public.xp_award_action(
        p_action_code := 'xp_onboarding_completed_100',
        p_source_type := 'onboarding',
        p_source_id := 'user_profiles.score',
        p_idempotency_key := format('xp_onboarding_completed_100:%s', new.user_id::text),
        p_metadata := jsonb_build_object(
          'trigger', 'user_profiles.score_100',
          'new_score', v_new_score,
          'old_score', v_old_score
        ),
        p_request_id := null
      );
    exception
      when undefined_function then
        null;
      when others then
        null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_xp_user_profile_score_100_hook on public.user_profiles;
create trigger trg_xp_user_profile_score_100_hook
after insert or update on public.user_profiles
for each row
execute function public.xp_user_profile_score_100_hook();
