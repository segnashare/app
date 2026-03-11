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

  -- Reconcile auth/public user mirrors to avoid FK failures on session logging.
  insert into public.users (id, email, phone)
  select u.id, u.email, u.phone
  from auth.users u
  where u.id = v_uid
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone;

  if not exists (select 1 from public.users where id = v_uid) then
    raise exception 'Authenticated user does not exist in auth.users';
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

grant execute on function public.upsert_user_session(text, timestamptz, inet, text) to authenticated;
