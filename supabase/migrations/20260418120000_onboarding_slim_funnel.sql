-- Parcours onboarding réduit + renommage experience -> interests (URL).
-- Met à jour les sessions, la contrainte sur current_step, le bootstrap et la fonction bootstrap.

update public.onboarding_sessions
set current_step = '/onboarding/privacy'
where current_step in ('/onboarding/confidentiality', '/onboarding/confidentialite');

update public.onboarding_sessions
set current_step = '/onboarding/interests'
where current_step = '/onboarding/experience';

update public.onboarding_sessions
set current_step = '/onboarding/1'
where status <> 'completed'
  and current_step not in (
    '/onboarding/1',
    '/onboarding/phone',
    '/onboarding/phone/verify',
    '/onboarding/name',
    '/onboarding/2',
    '/onboarding/birth',
    '/onboarding/size',
    '/onboarding/3',
    '/onboarding/interests',
    '/onboarding/privacy',
    '/onboarding/end'
  );

alter table public.onboarding_sessions
  alter column current_step set default '/onboarding/1';

alter table public.onboarding_sessions
  drop constraint if exists onboarding_sessions_current_step_check;

alter table public.onboarding_sessions
  add constraint onboarding_sessions_current_step_check
  check (
    current_step in (
      '/onboarding/1',
      '/onboarding/phone',
      '/onboarding/phone/verify',
      '/onboarding/name',
      '/onboarding/2',
      '/onboarding/birth',
      '/onboarding/size',
      '/onboarding/3',
      '/onboarding/interests',
      '/onboarding/privacy',
      '/onboarding/end'
    )
  );

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_phone text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email, phone
  into v_email, v_phone
  from auth.users
  where id = v_uid;

  insert into public.users (id, email, phone, first_name, last_name, locale, timezone)
  values (v_uid, v_email, v_phone, p_first_name, p_last_name, p_locale, p_timezone)
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone,
      first_name = coalesce(excluded.first_name, public.users.first_name),
      last_name = coalesce(excluded.last_name, public.users.last_name),
      locale = coalesce(excluded.locale, public.users.locale),
      timezone = coalesce(excluded.timezone, public.users.timezone);

  insert into public.user_roles (user_id, role)
  values (v_uid, 'user')
  on conflict (user_id, role) do nothing;

  insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
  values (v_uid, 0, null)
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/1', jsonb_build_object('checkpoint', '/onboarding/1'))
  on conflict (user_id) do nothing;

  perform public.log_activity_event(
    p_event_name => 'bootstrap_user_after_signup',
    p_payload => jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone
    ),
    p_request_id => p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid) to authenticated;
