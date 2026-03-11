alter table public.users
  add column if not exists birth_date date;

alter table public.user_profiles
  add column if not exists age integer;

create or replace function public.sync_user_profile_age_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_age integer;
begin
  if new.birth_date is null then
    v_age := null;
  else
    v_age := extract(year from age(current_date, new.birth_date))::integer;
  end if;

  insert into public.user_profiles (user_id, age)
  values (new.id, v_age)
  on conflict (user_id) do update
  set age = excluded.age;

  return new;
end;
$$;

drop trigger if exists trg_users_sync_profile_age on public.users;
create trigger trg_users_sync_profile_age
after insert or update of birth_date on public.users
for each row
execute function public.sync_user_profile_age_from_users();

create or replace function public.set_user_birth_date(
  p_birth_date date,
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
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_birth_date is null then
    raise exception 'Birth date is required';
  end if;

  if p_birth_date > current_date then
    raise exception 'Birth date cannot be in the future';
  end if;

  insert into public.users (id, birth_date)
  values (v_uid, p_birth_date)
  on conflict (id) do update
  set birth_date = excluded.birth_date
  returning * into v_row;

  perform public.log_activity_event(
    p_event_name => 'set_user_birth_date',
    p_payload => jsonb_build_object('birth_date', p_birth_date),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

grant execute on function public.set_user_birth_date(date, uuid) to authenticated;

update public.user_profiles up
set age = extract(year from age(current_date, u.birth_date))::integer
from public.users u
where up.user_id = u.id
  and u.birth_date is not null;
