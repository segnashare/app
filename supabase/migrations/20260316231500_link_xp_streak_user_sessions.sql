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

  -- Reconcile auth/public user mirrors without erasing app-owned fields.
  insert into public.users (id, email, phone)
  select u.id, u.email, u.phone
  from auth.users u
  where u.id = v_uid
  on conflict (id) do update
  set email = coalesce(excluded.email, public.users.email),
      phone = coalesce(public.users.phone, excluded.phone);

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

  -- Hook daily streak progression to session activity.
  -- Safe to call on every upsert: xp_touch_daily_visit is idempotent per day/user.
  begin
    perform public.xp_touch_daily_visit(
      p_source_id := coalesce(nullif(trim(p_session_token), ''), 'session'),
      p_request_id := null
    );
  exception
    when undefined_function then
      -- XP module not deployed yet: keep session logging healthy.
      null;
    when others then
      -- Never block auth/session flow because of gamification side-effects.
      null;
  end;

  return v_row;
end;
$$;

grant execute on function public.upsert_user_session(text, timestamptz, inet, text) to authenticated;
