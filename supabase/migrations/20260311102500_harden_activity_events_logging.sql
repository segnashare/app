create or replace function public.log_activity_event(
  p_event_name text,
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_entity_type text := 'system';
  v_action text := coalesce(nullif(trim(p_event_name), ''), 'updated');
  v_has_user_id boolean;
  v_has_actor_id boolean;
  v_has_actor_role boolean;
  v_has_entity_type boolean;
  v_has_entity_id boolean;
  v_has_action boolean;
  v_has_event_name boolean;
  v_has_payload boolean;
  v_has_metadata boolean;
  v_has_request_id boolean;
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sql text;
begin
  v_uid := auth.uid();

  -- Map legacy event names to normalized audit vocabulary.
  case p_event_name
    when 'bootstrap_user_after_signup' then
      v_entity_type := 'user';
      v_action := 'created';
    when 'upsert_onboarding_progress' then
      v_entity_type := 'onboarding_session';
      v_action := 'onboarding_step_updated';
    when 'complete_onboarding' then
      v_entity_type := 'onboarding_session';
      v_action := 'onboarding_completed';
    when 'update_user_profile_public' then
      v_entity_type := 'user_profile';
      v_action := 'updated';
    when 'update_user_account_settings' then
      v_entity_type := 'user_preferences';
      v_action := 'updated';
    when 'accept_user_consent' then
      v_entity_type := 'user_consent';
      v_action := case
        when coalesce((p_payload ->> 'granted')::boolean, false) then 'consent_granted'
        else 'consent_revoked'
      end;
    when 'set_user_profile_brands' then
      v_entity_type := 'user_profile';
      v_action := 'updated';
    when 'set_user_profile_sizes' then
      v_entity_type := 'user_profile';
      v_action := 'updated';
    when 'set_profile_preference_visibility' then
      v_entity_type := 'user_preferences';
      v_action := 'updated';
    else
      null;
  end case;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'user_id'
  ) into v_has_user_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'actor_id'
  ) into v_has_actor_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'actor_role'
  ) into v_has_actor_role;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'entity_type'
  ) into v_has_entity_type;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'entity_id'
  ) into v_has_entity_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'action'
  ) into v_has_action;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'event_name'
  ) into v_has_event_name;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'payload'
  ) into v_has_payload;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'metadata'
  ) into v_has_metadata;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'request_id'
  ) into v_has_request_id;

  if v_has_user_id and v_uid is not null then
    v_cols := array_append(v_cols, 'user_id');
    v_vals := array_append(v_vals, format('%L::uuid', v_uid));
  end if;

  if v_has_actor_id and v_uid is not null then
    v_cols := array_append(v_cols, 'actor_id');
    v_vals := array_append(v_vals, format('%L::uuid', v_uid));
  end if;

  if v_has_actor_role then
    v_cols := array_append(v_cols, 'actor_role');
    v_vals := array_append(v_vals, case when v_uid is null then 'null' else '''user''' end);
  end if;

  if v_has_entity_type then
    v_cols := array_append(v_cols, 'entity_type');
    v_vals := array_append(v_vals, format('%L', v_entity_type));
  end if;

  if v_has_entity_id then
    v_cols := array_append(v_cols, 'entity_id');
    if v_uid is not null and v_entity_type in ('user', 'user_profile', 'user_preferences', 'onboarding_session') then
      v_vals := array_append(v_vals, format('%L::uuid', v_uid));
    else
      v_vals := array_append(v_vals, 'null');
    end if;
  end if;

  if v_has_action then
    v_cols := array_append(v_cols, 'action');
    v_vals := array_append(v_vals, format('%L', v_action));
  end if;

  if v_has_event_name then
    v_cols := array_append(v_cols, 'event_name');
    v_vals := array_append(v_vals, format('%L', p_event_name));
  end if;

  if v_has_payload then
    v_cols := array_append(v_cols, 'payload');
    v_vals := array_append(v_vals, format('%L::jsonb', coalesce(p_payload, '{}'::jsonb)::text));
  end if;

  if v_has_metadata then
    v_cols := array_append(v_cols, 'metadata');
    v_vals := array_append(v_vals, format('%L::jsonb', coalesce(p_payload, '{}'::jsonb)::text));
  end if;

  if v_has_request_id then
    v_cols := array_append(v_cols, 'request_id');
    v_vals := array_append(v_vals, format('%L::uuid', p_request_id));
  end if;

  if array_length(v_cols, 1) is null then
    return;
  end if;

  v_sql := format(
    'insert into public.activity_events (%s) values (%s)',
    array_to_string(v_cols, ', '),
    array_to_string(v_vals, ', ')
  );

  execute v_sql;
end;
$$;

grant execute on function public.log_activity_event(text, jsonb, uuid) to authenticated;
