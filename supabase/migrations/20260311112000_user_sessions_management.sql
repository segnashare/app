create index if not exists user_sessions_user_id_idx
  on public.user_sessions (user_id);

create index if not exists user_sessions_expires_at_idx
  on public.user_sessions (expires_at);

create or replace function public.upsert_user_session(
  p_session_token text,
  p_expires_at timestamptz default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns public.user_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_sessions;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(p_session_token), '') is null then
    raise exception 'Session token is required';
  end if;

  insert into public.user_sessions (
    user_id,
    session_token,
    ip_address,
    user_agent,
    expires_at
  )
  values (
    v_uid,
    p_session_token,
    p_ip_address,
    p_user_agent,
    p_expires_at
  )
  on conflict (session_token) do update
  set user_id = excluded.user_id,
      ip_address = excluded.ip_address,
      user_agent = excluded.user_agent,
      expires_at = excluded.expires_at
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_user_session(
  p_session_token text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_deleted bigint := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(p_session_token), '') is null then
    return 0;
  end if;

  delete from public.user_sessions
  where user_id = v_uid
    and session_token = p_session_token;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.revoke_other_user_sessions(
  p_current_session_token text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_deleted bigint := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.user_sessions
  where user_id = v_uid
    and (
      nullif(trim(p_current_session_token), '') is null
      or session_token <> p_current_session_token
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.purge_expired_user_sessions()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint := 0;
begin
  delete from public.user_sessions
  where expires_at is not null
    and expires_at < now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.upsert_user_session(text, timestamptz, inet, text) to authenticated;
grant execute on function public.revoke_user_session(text) to authenticated;
grant execute on function public.revoke_other_user_sessions(text) to authenticated;
grant execute on function public.purge_expired_user_sessions() to authenticated;
