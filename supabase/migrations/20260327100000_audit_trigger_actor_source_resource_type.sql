-- Le trigger audit_activity_event_from_db_trigger insérait dans activity_events
-- sans actor_source / resource_type après suppression des DEFAULT (migration
-- 20260323230100). Les colonnes sont NOT NULL → échec INSERT au login
-- (mise à jour auth.users) et 500 côté Supabase Auth.

create or replace function public.audit_activity_event_from_db_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entity_type text;
  v_action text;
  v_event_name text;
  v_entity_id uuid;
  v_actor_user_id uuid;
  v_user_id uuid;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_changed_columns text[] := '{}'::text[];
  v_payload jsonb;
  v_actor_source public.activity_actor_source;
  v_resource_type public.activity_resource_type;
begin
  v_action := case tg_op
    when 'INSERT' then 'created'
    when 'UPDATE' then 'updated'
    when 'DELETE' then 'deleted'
    else lower(tg_op)
  end;

  v_event_name := format('manual_%s_%s_%s', tg_table_schema, tg_table_name, lower(tg_op));

  if tg_table_schema = 'auth' and tg_table_name = 'users' then
    v_entity_type := 'auth_user';
    v_entity_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);
    v_user_id := v_entity_id;
  elsif tg_table_schema = 'public' and tg_table_name = 'users' then
    v_entity_type := 'user';
    v_entity_id := coalesce(new.id, old.id);
    v_user_id := v_entity_id;
  elsif tg_table_schema = 'public' and tg_table_name = 'user_profiles' then
    v_entity_type := 'user_profile';
    v_entity_id := coalesce(new.id, old.id);
    v_user_id := coalesce(new.user_id, old.user_id);
  elsif tg_table_schema = 'public' and tg_table_name = 'user_preferences' then
    v_entity_type := 'user_preferences';
    v_entity_id := coalesce(new.id, old.id);
    select up.user_id
      into v_user_id
    from public.user_profiles up
    where up.id = coalesce(new.user_profile_id, old.user_profile_id)
    limit 1;
  else
    v_entity_type := format('%s.%s', tg_table_schema, tg_table_name);
    v_entity_id := null;
    v_user_id := null;
  end if;

  begin
    v_actor_user_id := auth.uid();
  exception when others then
    v_actor_user_id := null;
  end;

  if v_actor_user_id is not null and not exists (
    select 1 from public.users u where u.id = v_actor_user_id
  ) then
    v_actor_user_id := null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - array[
      'encrypted_password',
      'confirmation_token',
      'recovery_token',
      'email_change_token_new',
      'email_change_token_current',
      'reauthentication_token'
    ];
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - array[
      'encrypted_password',
      'confirmation_token',
      'recovery_token',
      'email_change_token_new',
      'email_change_token_current',
      'reauthentication_token'
    ];
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k), '{}'::text[])
      into v_changed_columns
    from (
      select key as k
      from jsonb_object_keys(v_new) key
      where (v_old->key) is distinct from (v_new->key)
      union
      select key as k
      from jsonb_object_keys(v_old) key
      where not (v_new ? key)
    ) s;
  end if;

  v_payload := jsonb_build_object(
    'source', 'db_trigger',
    'schema', tg_table_schema,
    'table', tg_table_name,
    'operation', tg_op,
    'changed_columns', to_jsonb(v_changed_columns),
    'old', coalesce(v_old, '{}'::jsonb),
    'new', coalesce(v_new, '{}'::jsonb)
  );

  v_resource_type := public.map_entity_type_to_resource_type(v_entity_type);
  v_actor_source :=
    case
      when v_actor_user_id is not null and v_user_id is not null
        and v_actor_user_id is distinct from v_user_id
        then 'staff'::public.activity_actor_source
      when v_actor_user_id is not null
        then 'member'::public.activity_actor_source
      else 'system'::public.activity_actor_source
    end;

  insert into public.activity_events (
    actor_user_id,
    actor_role,
    actor_source,
    resource_type,
    request_id,
    entity_type,
    entity_id,
    action,
    payload,
    user_id,
    event_name
  ) values (
    v_actor_user_id,
    'admin'::public.app_role,
    v_actor_source,
    v_resource_type,
    null,
    v_entity_type,
    v_entity_id,
    v_action,
    coalesce(v_payload, '{}'::jsonb),
    v_user_id,
    v_event_name
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
