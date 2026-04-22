-- Les clés API « sb_secret_* » peuvent authentifier PostgREST en service_role sans peupler
-- request.jwt.claim.role. Seul service_role a EXECUTE sur log_activity_event_rpc : on n’exige
-- le GUC que s’il est renseigné (sinon on accepte).

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
  v_role text;
begin
  v_role := nullif(
    trim(coalesce(current_setting('request.jwt.claim.role', true), '')),
    ''
  );

  if v_role is not null and v_role is distinct from 'service_role' then
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
