create or replace function public.sync_user_profile_display_name_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if nullif(trim(coalesce(new.first_name, '')), '') is not null
     and nullif(trim(coalesce(new.last_name, '')), '') is not null then
    v_display_name := trim(new.first_name) || ' ' || upper(left(trim(new.last_name), 1)) || '.';
  else
    v_display_name := null;
  end if;

  insert into public.user_profiles (user_id, display_name)
  values (new.id, v_display_name)
  on conflict (user_id) do update
  set display_name = excluded.display_name;

  return new;
end;
$$;

drop trigger if exists trg_users_sync_display_name on public.users;
create trigger trg_users_sync_display_name
after insert or update of first_name, last_name on public.users
for each row
execute function public.sync_user_profile_display_name_from_users();

update public.user_profiles up
set display_name = case
  when nullif(trim(coalesce(u.first_name, '')), '') is not null
   and nullif(trim(coalesce(u.last_name, '')), '') is not null
    then trim(u.first_name) || ' ' || upper(left(trim(u.last_name), 1)) || '.'
  else null
end
from public.users u
where up.user_id = u.id;
