do $$
declare
  v_status_udt text;
  v_default_status text;
begin
  select c.udt_name
  into v_status_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'users'
    and c.column_name = 'status'
  limit 1;

  if v_status_udt = 'user_status' then
    select e.enumlabel
    into v_default_status
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'user_status'
      and e.enumlabel in ('pending_onboarding', 'onboarding', 'pending', 'active')
    order by case e.enumlabel
      when 'pending_onboarding' then 1
      when 'onboarding' then 2
      when 'pending' then 3
      when 'active' then 4
      else 100
    end
    limit 1;

    if v_default_status is null then
      select e.enumlabel
      into v_default_status
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'user_status'
      order by e.enumsortorder
      limit 1;
    end if;

    if v_default_status is not null then
      execute format(
        'alter table public.users alter column status set default %L::user_status',
        v_default_status
      );
    end if;
  elsif v_status_udt in ('text', 'varchar', 'bpchar') then
    alter table public.users
      alter column status set default 'pending_onboarding';
  end if;
end
$$;

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

  insert into public.user_wallets (user_id, balance)
  values (v_uid, 0)
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/welcome', jsonb_build_object('checkpoint', '/onboarding/welcome'))
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
