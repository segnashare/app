-- display_name : majuscule sur la première lettre du prénom (comme pour l’initiale du nom).

create or replace function public.format_display_name_from_names(p_first_name text, p_last_name text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when nullif(trim(coalesce(p_first_name, '')), '') is null
      or nullif(trim(coalesce(p_last_name, '')), '') is null
    then null
    else
      (
        upper(left(trim(p_first_name), 1))
        || substring(trim(p_first_name) from 2)
      )
      || ' '
      || upper(left(trim(p_last_name), 1))
      || '.'
  end;
$$;

comment on function public.format_display_name_from_names(text, text) is
  'Construit le display_name « Prénom N. » avec première lettre du prénom en majuscule.';

create or replace function public.sync_user_profile_display_name_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := public.format_display_name_from_names(new.first_name, new.last_name);

  insert into public.user_profiles (user_id, display_name)
  values (new.id, v_display_name)
  on conflict (user_id) do update
  set display_name = excluded.display_name;

  return new;
end;
$$;

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

  v_display_name := public.format_display_name_from_names(v_row.first_name, v_row.last_name);

  if v_display_name is not null then
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

-- Recalculer tous les display_name dérivés des noms (corrige les entrées existantes type « claire-marie L. »).
update public.user_profiles up
set display_name = public.format_display_name_from_names(u.first_name, u.last_name)
from public.users u
where up.user_id = u.id
  and public.format_display_name_from_names(u.first_name, u.last_name) is not null;
