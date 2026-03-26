-- ---------------------------------------------------------------------------
-- 2) Enums activity log
-- ---------------------------------------------------------------------------

create type public.activity_actor_source as enum (
  'member', -- action membre dans l’app (auth.uid() = acteur)
  'system', -- jobs / crons / automatique
  'staff',  -- backoffice Segna (actor_user_id = admin)
  'rpc'     -- RPC / service role / scripts internes Supabase
);

create type public.activity_resource_type as enum (
  'user',
  'item',
  'cart',
  'shipment',
  'wallet',
  'report',
  'order',
  'moderation',
  'onboarding',
  'system',
  'other'
);

create type public.activity_severity as enum (
  'info',
  'warning',
  'error',
  'critical'
);

-- ---------------------------------------------------------------------------
-- 3) Colonnes activity_events + backfill
-- ---------------------------------------------------------------------------

alter table public.activity_events
  add column if not exists actor_source public.activity_actor_source not null default 'member';

alter table public.activity_events
  add column if not exists resource_type public.activity_resource_type not null default 'other';

alter table public.activity_events
  add column if not exists severity public.activity_severity not null default 'info';

alter table public.activity_events
  alter column actor_source drop default;

alter table public.activity_events
  alter column resource_type drop default;

-- Heuristique historique (best-effort)
update public.activity_events e
set actor_source = 'staff'
where e.actor_user_id is not null
  and e.user_id is not null
  and e.actor_user_id <> e.user_id;

update public.activity_events e
set actor_source = 'system'
where e.actor_user_id is null
  and e.user_id is null;

-- Mapper entity_type (granulaire) -> resource_type (filtres backoffice)
create or replace function public.map_entity_type_to_resource_type(p_entity_type text)
returns public.activity_resource_type
language sql
immutable
as $$
  select case
    when p_entity_type is null or btrim(p_entity_type) = '' then 'other'::public.activity_resource_type
    when lower(p_entity_type) like 'user%' or p_entity_type in ('user_profile', 'user_preferences', 'user_consent')
      then 'user'::public.activity_resource_type
    when lower(p_entity_type) like 'item%' then 'item'::public.activity_resource_type
    when lower(p_entity_type) like 'cart%' then 'cart'::public.activity_resource_type
    when lower(p_entity_type) like 'shipment%' or lower(p_entity_type) like 'parcel%' then 'shipment'::public.activity_resource_type
    when lower(p_entity_type) like 'wallet%' or lower(p_entity_type) like 'billing%' then 'wallet'::public.activity_resource_type
    when lower(p_entity_type) like '%report%' or lower(p_entity_type) like 'app_report' then 'report'::public.activity_resource_type
    when lower(p_entity_type) like '%moderation%' or lower(p_entity_type) like 'moderation_ticket%' then 'moderation'::public.activity_resource_type
    when lower(p_entity_type) like 'order%' then 'order'::public.activity_resource_type
    when lower(p_entity_type) like 'onboarding%' then 'onboarding'::public.activity_resource_type
    when lower(p_entity_type) = 'system' then 'system'::public.activity_resource_type
    else 'other'::public.activity_resource_type
  end;
$$;

update public.activity_events e
set resource_type = public.map_entity_type_to_resource_type(e.entity_type);

-- ---------------------------------------------------------------------------
-- 4) Index (filtrage rapide par période + type + source)
-- ---------------------------------------------------------------------------

create index if not exists activity_events_created_at_desc_idx
  on public.activity_events (created_at desc);

create index if not exists activity_events_resource_type_created_at_idx
  on public.activity_events (resource_type, created_at desc);

create index if not exists activity_events_actor_source_created_at_idx
  on public.activity_events (actor_source, created_at desc);

create index if not exists activity_events_subject_user_created_at_idx
  on public.activity_events (user_id, created_at desc)
  where user_id is not null;

create index if not exists activity_events_actor_user_created_at_idx
  on public.activity_events (actor_user_id, created_at desc)
  where actor_user_id is not null;

-- ---------------------------------------------------------------------------
-- 5) log_activity_event (client) : member + resource_type + severity
-- ---------------------------------------------------------------------------

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
  v_has_actor_user_id boolean;
  v_has_actor_role boolean;
  v_has_entity_type boolean;
  v_has_entity_id boolean;
  v_has_action boolean;
  v_has_event_name boolean;
  v_has_payload boolean;
  v_has_metadata boolean;
  v_has_request_id boolean;
  v_has_actor_source boolean;
  v_has_resource_type boolean;
  v_has_severity boolean;
  v_request_id_udt text;
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sql text;
  v_resource_type public.activity_resource_type;
begin
  v_uid := auth.uid();

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

  v_resource_type := public.map_entity_type_to_resource_type(v_entity_type);

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
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'actor_user_id'
  ) into v_has_actor_user_id;

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

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'actor_source'
  ) into v_has_actor_source;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'resource_type'
  ) into v_has_resource_type;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_events' and column_name = 'severity'
  ) into v_has_severity;

  if v_has_request_id then
    select c.udt_name
    into v_request_id_udt
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'activity_events'
      and c.column_name = 'request_id'
    limit 1;
  end if;

  if v_has_user_id and v_uid is not null then
    v_cols := array_append(v_cols, 'user_id');
    v_vals := array_append(v_vals, format('%L::uuid', v_uid));
  end if;

  if v_has_actor_id and v_uid is not null then
    v_cols := array_append(v_cols, 'actor_id');
    v_vals := array_append(v_vals, format('%L::uuid', v_uid));
  end if;

  if v_has_actor_user_id and v_uid is not null then
    v_cols := array_append(v_cols, 'actor_user_id');
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
    if p_request_id is null then
      v_vals := array_append(v_vals, 'null');
    elsif v_request_id_udt = 'uuid' then
      v_vals := array_append(v_vals, format('%L::uuid', p_request_id::text));
    else
      v_vals := array_append(v_vals, format('%L', p_request_id::text));
    end if;
  end if;

  if v_has_actor_source then
    v_cols := array_append(v_cols, 'actor_source');
    v_vals := array_append(v_vals, '''member''::public.activity_actor_source');
  end if;

  if v_has_resource_type then
    v_cols := array_append(v_cols, 'resource_type');
    v_vals := array_append(v_vals, format('%L::public.activity_resource_type', v_resource_type::text));
  end if;

  if v_has_severity then
    v_cols := array_append(v_cols, 'severity');
    v_vals := array_append(v_vals, '''info''::public.activity_severity');
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

-- ---------------------------------------------------------------------------
-- 6) Backoffice staff (JWT admin) — actor_source = staff
-- ---------------------------------------------------------------------------

create or replace function public.log_activity_event_staff(
  p_event_name text,
  p_action text,
  p_subject_user_id uuid,
  p_resource_type public.activity_resource_type,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_severity public.activity_severity default 'info',
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid := auth.uid();
  v_entity text;
begin
  if v_staff is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = v_staff
      and ur.role::text = 'admin'
  ) then
    raise exception 'not_admin';
  end if;

  v_entity := coalesce(nullif(trim(p_entity_type), ''), lower(p_resource_type::text));

  insert into public.activity_events (
    event_name,
    action,
    actor_source,
    actor_user_id,
    actor_role,
    user_id,
    entity_type,
    entity_id,
    resource_type,
    severity,
    payload,
    request_id
  ) values (
    p_event_name,
    p_action,
    'staff',
    v_staff,
    'admin'::public.app_role,
    p_subject_user_id,
    v_entity,
    p_entity_id,
    p_resource_type,
    p_severity,
    coalesce(p_payload, '{}'::jsonb),
    p_request_id
  );
end;
$$;

grant execute on function public.log_activity_event_staff(
  text, text, uuid, public.activity_resource_type, text, uuid, public.activity_severity, jsonb, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) RPC / service_role — actor_source = rpc
-- ---------------------------------------------------------------------------

create or replace function public.log_activity_event_rpc(
  p_event_name text,
  p_action text,
  p_subject_user_id uuid,
  p_resource_type public.activity_resource_type,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_severity public.activity_severity default 'info',
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text;
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );
begin
  if v_role is distinct from 'service_role' then
    raise exception 'service_role_only';
  end if;

  v_entity := coalesce(nullif(trim(p_entity_type), ''), lower(p_resource_type::text));

  insert into public.activity_events (
    event_name,
    action,
    actor_source,
    actor_user_id,
    actor_role,
    user_id,
    entity_type,
    entity_id,
    resource_type,
    severity,
    payload,
    request_id
  ) values (
    p_event_name,
    p_action,
    'rpc',
    null,
    null,
    p_subject_user_id,
    v_entity,
    p_entity_id,
    p_resource_type,
    p_severity,
    coalesce(p_payload, '{}'::jsonb),
    p_request_id
  );
end;
$$;

grant execute on function public.log_activity_event_rpc(
  text, text, uuid, public.activity_resource_type, text, uuid, public.activity_severity, jsonb, uuid
) to service_role;

-- (Policies item_condition_history déjà dans 20260323230000_app_role_remove_super_admin.sql)
