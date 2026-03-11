create or replace function public.update_user_account_settings(
  p_locale text default null,
  p_timezone text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_request_id uuid default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.users;
  v_display_name text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.users (id)
  values (v_uid)
  on conflict (id) do nothing;

  update public.users
  set locale = coalesce(p_locale, locale),
      timezone = coalesce(p_timezone, timezone),
      first_name = coalesce(p_first_name, first_name),
      last_name = coalesce(p_last_name, last_name)
  where id = v_uid
  returning * into v_row;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  if nullif(trim(coalesce(v_row.first_name, '')), '') is not null
     and nullif(trim(coalesce(v_row.last_name, '')), '') is not null then
    v_display_name := trim(v_row.first_name) || ' ' || upper(left(trim(v_row.last_name), 1)) || '.';

    update public.user_profiles
    set display_name = v_display_name
    where user_id = v_uid;
  end if;

  perform public.log_activity_event(
    p_event_name => 'update_user_account_settings',
    p_payload => jsonb_build_object(
      'locale', p_locale,
      'timezone', p_timezone,
      'first_name', p_first_name,
      'last_name', p_last_name,
      'display_name', v_display_name
    ),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

grant execute on function public.update_user_account_settings(text, text, text, text, uuid) to authenticated;

update public.user_profiles up
set display_name = trim(u.first_name) || ' ' || upper(left(trim(u.last_name), 1)) || '.'
from public.users u
where up.user_id = u.id
  and nullif(trim(coalesce(u.first_name, '')), '') is not null
  and nullif(trim(coalesce(u.last_name, '')), '') is not null
  and coalesce(up.display_name, '') = '';
