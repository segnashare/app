create or replace function public.derive_relative_city_from_adress(p_adress text)
returns text
language plpgsql
immutable
as $$
declare
  v_adress text;
  v_postcode text;
  v_arrondissement integer;
  v_city text;
begin
  v_adress := nullif(trim(coalesce(p_adress, '')), '');
  if v_adress is null then
    return null;
  end if;

  v_postcode := substring(v_adress from '\m(750[1-9]|751[0-9]|7520|6900[1-9]|1300[1-9]|1301[0-6])\M');
  if v_postcode is not null then
    if left(v_postcode, 2) = '75' then
      v_arrondissement := cast(right(v_postcode, 2) as integer);
      return case
        when v_arrondissement = 1 then 'Paris 1er arrondissement'
        else format('Paris %sème arrondissement', v_arrondissement)
      end;
    elsif left(v_postcode, 2) = '69' then
      v_arrondissement := cast(right(v_postcode, 2) as integer);
      return case
        when v_arrondissement = 1 then 'Lyon 1er arrondissement'
        else format('Lyon %sème arrondissement', v_arrondissement)
      end;
    elsif left(v_postcode, 2) = '13' then
      v_arrondissement := cast(right(v_postcode, 2) as integer);
      return case
        when v_arrondissement = 1 then 'Marseille 1er arrondissement'
        else format('Marseille %sème arrondissement', v_arrondissement)
      end;
    end if;
  end if;

  v_city := substring(v_adress from '\m\d{5}\s+([A-Za-zÀ-ÿ'' -]+)\M');
  if nullif(trim(coalesce(v_city, '')), '') is not null then
    return initcap(trim(v_city));
  end if;

  return null;
end;
$$;

create or replace function public.sync_user_profile_location_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_relative_city text;
begin
  v_timezone := coalesce(new.timezone, 'Europe/Paris');
  v_relative_city := public.derive_relative_city_from_adress(new.adress);

  insert into public.user_profiles (user_id, city, profile_data)
  values (
    new.id,
    v_relative_city,
    jsonb_build_object(
      'location',
      jsonb_build_object(
        'label', new.adress,
        'timezone', v_timezone
      )
    )
  )
  on conflict (user_id) do update
  set city = excluded.city,
      profile_data = jsonb_set(
        jsonb_set(
          coalesce(public.user_profiles.profile_data, '{}'::jsonb),
          '{location,label}',
          to_jsonb(new.adress),
          true
        ),
        '{location,timezone}',
        to_jsonb(v_timezone),
        true
      );

  return new;
end;
$$;

drop trigger if exists trg_users_sync_location on public.users;
create trigger trg_users_sync_location
after insert or update of adress, timezone on public.users
for each row
execute function public.sync_user_profile_location_from_users();

insert into public.user_profiles (user_id)
select u.id
from public.users u
left join public.user_profiles up on up.user_id = u.id
where up.user_id is null;

update public.user_profiles up
set city = public.derive_relative_city_from_adress(u.adress),
    profile_data = jsonb_set(
      jsonb_set(
        coalesce(up.profile_data, '{}'::jsonb),
        '{location,label}',
        to_jsonb(u.adress),
        true
      ),
      '{location,timezone}',
      to_jsonb(coalesce(u.timezone, 'Europe/Paris')),
      true
    )
from public.users u
where up.user_id = u.id;
